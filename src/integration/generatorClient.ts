import fetch from 'node-fetch';
import { createHash } from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';

export interface EaziPayGenerationOptions {
  rows: number;
  seed?: number;
  allowedTransactionCodes?: string[];
  originating?: {
    sortCode?: string;
    accountNumber?: string;
    accountName?: string;
    sunNumber?: string;
    sunName?: string;
    import { createLogger } from '../shared/logger.js';
  };
}

export interface EaziPayResult {
  csvContent: string;
  checksumSha256: string;
  rows: number;
  filename: string;
}

const DEFAULT_RETRIES = 4;

async function httpGenerate(url: string, opts: EaziPayGenerationOptions): Promise<EaziPayResult> {
  const body = {
    fileType: 'EaziPay',
    rows: opts.rows,
    seed: opts.seed,
    allowedTransactionCodes: opts.allowedTransactionCodes,
    originating: opts.originating,
  };
  // Debug: log outbound payload to help trace originating/SUN propagation
  try {
    // eslint-disable-next-line no-console
    console.debug('[generatorClient] HTTP generate payload:', JSON.stringify(body));
  } catch {
        logger.debug({ event: 'generatorClient.httpPayload', payload: body }, '[generatorClient] HTTP generate payload');
  }
  const res = await fetch(`${url.replace(/\/$/, '')}/generate-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Generator HTTP ${res.status}`);
  const csvContent = await res.text();
  const lines = csvContent.split(/\n/).filter(l => l.trim().length > 0).length;
  const checksumSha256 = createHash('sha256').update(csvContent).digest('hex');
  const filename = `EaziPay-${opts.rows}${opts.seed != null ? `-${opts.seed}` : ''}.csv`;
  return { csvContent, checksumSha256, rows: lines, filename };
}

async function directImport(opts: EaziPayGenerationOptions): Promise<EaziPayResult> {
  // Fallback path: import generator library directly if available as sibling workspace.
  try {
    // Resolve sibling workspace package (assumes facade is in c:/git/BACS/facade)
    const candidate = path.resolve(process.cwd(), '..', 'bacs-file-data-generator', 'dist', 'index.js');
    const fileUrl = pathToFileURL(candidate).href;
    const mod: any = await import(fileUrl);
    if (!mod || !mod.generateFile) throw new Error('generateFile export missing');
    const genReq = { fileType: 'EaziPay', numberOfRows: opts.rows, originating: opts.originating };
    try {
      // eslint-disable-next-line no-console
      console.debug('[generatorClient] direct import genReq:', JSON.stringify(genReq));
    } catch {
          logger.debug({ event: 'generatorClient.directImport', payload: genReq }, '[generatorClient] direct import genReq');
    }
    const result = await mod.generateFile(genReq);
    const csvContent: string = result.fileContent;
    const checksumSha256 = createHash('sha256').update(csvContent).digest('hex');
    const lines = csvContent.split(/\n/).filter(l => l.trim().length > 0).length;
    return { csvContent, checksumSha256, rows: lines, filename: `EaziPay-${opts.rows}.csv` };
  } catch (err) {
    throw new Error(`Direct import failed: ${(err as Error).message}`);
  }
}

export async function generateEaziPayWithRetry(url: string | undefined, opts: EaziPayGenerationOptions, retries = DEFAULT_RETRIES): Promise<EaziPayResult> {
  const baseErrors: string[] = [];
  if (url) {
    for (let i = 0; i < retries; i++) {
      try { return await httpGenerate(url, opts); } catch (err) { baseErrors.push((err as Error).message); await new Promise(r => setTimeout(r, 40 * (i + 1))); }
    }
  }
  // Fallback direct import attempt
  return directImport(opts);
}
