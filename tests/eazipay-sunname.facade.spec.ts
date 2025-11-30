import { describe, it, expect, beforeAll, vi } from 'vitest';
// Force test environment flags early
process.env.NODE_ENV = 'test';
process.env.VITEST = '1';
process.env.REPORT_API_ENTRY = process.env.REPORT_API_ENTRY || 'stub-adapter';
process.env.JOB_FORCE_DDICA_STUB = '1';
import path from 'path';
import { promises as fs } from 'fs';
// Ensure adapter env is present before any dynamic imports
process.env.GENERATOR_ENTRY = process.env.GENERATOR_ENTRY || path.resolve(__dirname, 'helpers', 'generator.stub.ts');
process.env.OUTPUT_ROOT = process.env.OUTPUT_ROOT || path.resolve(process.cwd(), 'output');
// Mock generator client to ensure SUN fields propagate deterministically
vi.mock('../src/integration/generatorClient.ts', () => {
  return {
    generateEaziPayWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 5);
      const header = 'c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11';
      const sunName = opts?.sun?.sunName ?? opts?.originating?.sunName ?? '';
      const body = Array.from({ length: rows }, () => `a,b,c,d,e,f,g,h,i,j,${sunName}`);
      const csvContent = [header, ...body].join('\n');
      return {
        csvContent,
        checksumSha256: 'stub',
        rows,
        filename: `EaziPay-${rows}.csv`,
      };
    },
  };
});
vi.mock('../src/integration/generatorClient.js', () => {
  return {
    generateEaziPayWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 5);
      const header = 'c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11';
      const sunName = opts?.sun?.sunName ?? opts?.originating?.sunName ?? '';
      const body = Array.from({ length: rows }, () => `a,b,c,d,e,f,g,h,i,j,${sunName}`);
      const csvContent = [header, ...body].join('\n');
      return { csvContent, checksumSha256: 'stub', rows, filename: `EaziPay-${rows}.csv` };
    },
  };
});
vi.mock('../integration/generatorClient.js', () => {
  return {
    generateEaziPayWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 5);
      const header = 'c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11';
      const sunName = opts?.sun?.sunName ?? opts?.originating?.sunName ?? '';
      const body = Array.from({ length: rows }, () => `a,b,c,d,e,f,g,h,i,j,${sunName}`);
      const csvContent = [header, ...body].join('\n');
      return { csvContent, checksumSha256: 'stub', rows, filename: `EaziPay-${rows}.csv` };
    },
  };
});
// Mock report API client to avoid external dependency and missing adapter errors
vi.mock('../src/integration/reportApiClient.ts', () => {
  return {
    generateDdicaWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 3);
      const xmlContent = `<DDICA>${Array.from({ length: rows }, (_, i) => `<Row><SeqNo>${i + 1}</SeqNo></Row>`).join('')}</DDICA>`;
      return { xmlContent, checksumSha256: 'stub', rows, filename: 'DDICA.xml', xmlPath: 'DDICA.xml' };
    },
  };
});
vi.mock('../src/integration/reportApiClient.js', () => {
  return {
    generateDdicaWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 3);
      const xmlContent = `<DDICA>${Array.from({ length: rows }, (_, i) => `<Row><SeqNo>${i + 1}</SeqNo></Row>`).join('')}</DDICA>`;
      return { xmlContent, checksumSha256: 'stub', rows, filename: 'DDICA.xml', xmlPath: 'DDICA.xml' };
    },
  };
});
vi.mock('../integration/reportApiClient.js', () => {
  return {
    generateDdicaWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 3);
      const xmlContent = `<DDICA>${Array.from({ length: rows }, (_, i) => `<Row><SeqNo>${i + 1}</SeqNo></Row>`).join('')}</DDICA>`;
      return { xmlContent, checksumSha256: 'stub', rows, filename: 'DDICA.xml', xmlPath: 'DDICA.xml' };
    },
  };
});

async function waitForJobCompletion(app: any, jobId: string, timeoutMs = 10000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await app.inject({ method: 'GET', url: `/jobs/${jobId}/status` });
    const body = JSON.parse(String(res.body));
    if (body.state === 'completed') return;
    if (body.state === 'failed') throw new Error(`Job failed: ${JSON.stringify(body.error)}`);
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Timeout waiting for job completion');
}

function buildApp() {
  const fastify = require('fastify').default({ logger: false });
  fastify.register(require('@fastify/formbody'));
  process.env.SYNC_ROW_LIMIT = '10';
  process.env.OUTPUT_ROOT = path.resolve(process.cwd(), 'output-tests');
  return fastify;
}

describe('EaziPay SUN name propagation', () => {
  it('propagates provided sun.sunName into generated CSV final column', async () => {
    const app = buildApp();
    const { registerGenerateRoute } = await import('../src/routes/generate.js');
    await registerGenerateRoute(app as any);
    const { jobManager } = await import('../src/jobs/jobManager.js');
    await jobManager.init();
    const sunName = 'AlphaSUN';
    const res = await (app as any).inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 12, sun: { sunName } } });
    expect(res.statusCode).toBe(202);
    const jobId = res.json().jobId as string;
    await waitForJobCompletion(app, jobId, 8000);
    const statusRes = await (app as any).inject({ method: 'GET', url: `/jobs/${jobId}/status` });
    const status = statusRes.json();
    expect(status.state).toBe('completed');
    const csvName: string = status.output.filenames.find((f: string) => f.toLowerCase().startsWith('eazipay'));
    expect(csvName).toBeTruthy();
    const csvPath = path.join(process.env.OUTPUT_ROOT as string, jobId, csvName);
    const raw = await fs.readFile(csvPath, 'utf8');
    const lines = raw.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThan(1);
    // Skip header, validate each data row last column matches sunName
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      expect(cols[cols.length - 1]).toBe(sunName);
    }
  }, 15000);
});


