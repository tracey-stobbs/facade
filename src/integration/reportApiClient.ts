import fetch from 'node-fetch';
import { createHash } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

export interface DdicaGenerationOptions {
  rows: number;
  sun?: {
    sunNumber?: string;
    sunName?: string;
    sortCode?: string;
    accountNumber?: string;
    accountName?: string;
  };
  processingDate?: string;
}

export interface DdicaResult {
  xmlContent: string;
  checksumSha256: string;
  rows: number;
  filename: string;
  xmlPath: string;
}

const DEFAULT_RETRIES = 4;

async function httpGenerate(url: string, opts: DdicaGenerationOptions): Promise<DdicaResult> {
  const body = {
    report: 'ddica',
    rows: opts.rows,
    metadata: {
      Sun: { ...opts.sun },
      header: opts.processingDate ? { processingDate: opts.processingDate } : undefined,
    },
  };
  const res = await fetch(`${url.replace(/\/$/, '')}/translate/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let txt = '';
    try { txt = await res.text(); } catch { txt = ''; }
    throw new Error(`Report API HTTP ${res.status} ${txt}`);
  }
  const json: any = await res.json();
  const outputFolderRel: string = String(json.outputFolder); // e.g. _test-files/2025... or output-override/... relative to report api cwd
  const filename: string = (json.files && json.files.xml) ? String(json.files.xml) : 'DDICA.xml';
  // Attempt to read XML file from the sibling workspace; reconstruct path using REPORT_API_ROOT or fallback heuristic.
  const reportApiRoot = process.env.REPORT_API_ROOT || path.resolve(process.cwd(), '..', 'bacs-report-api');
  const xmlPath = path.isAbsolute(outputFolderRel)
    ? path.join(outputFolderRel, filename)
    : path.join(reportApiRoot, outputFolderRel, filename);
  let xmlContent = '';
  try {
    xmlContent = await fs.readFile(xmlPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed reading XML at ${xmlPath}: ${(err as Error).message}`);
  }
  const checksumSha256 = createHash('sha256').update(xmlContent).digest('hex');
  // Rough row extraction: count <SeqNo> occurrences for DDICA
  const rows = (xmlContent.match(/<SeqNo>/g) || []).length;
  return { xmlContent, checksumSha256, rows, filename, xmlPath };
}

export async function generateDdicaWithRetry(url: string | undefined, opts: DdicaGenerationOptions, retries = DEFAULT_RETRIES): Promise<DdicaResult> {
  if (!url) throw new Error('REPORT_API_URL not configured');
  const errors: string[] = [];
  for (let i = 0; i < retries; i++) {
    try { return await httpGenerate(url, opts); } catch (err) { errors.push((err as Error).message); await new Promise(r => setTimeout(r, 60 * (i + 1))); }
  }
  throw new Error(`DDICA generation failed after retries: ${errors.join('; ')}`);
}
