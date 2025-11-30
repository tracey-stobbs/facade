import { describe, it, expect, vi } from 'vitest';
// Force test environment flags early so integration clients choose stub logic
process.env.NODE_ENV = 'test';
process.env.VITEST = '1';
process.env.REPORT_API_ENTRY = process.env.REPORT_API_ENTRY || 'stub-adapter';
process.env.JOB_FORCE_DDICA_STUB = '1';
// Ensure adapter envs are present early
process.env.GENERATOR_ENTRY = process.env.GENERATOR_ENTRY || require('path').resolve(__dirname, 'helpers', 'generator.stub.ts');
process.env.OUTPUT_ROOT = process.env.OUTPUT_ROOT || require('path').resolve(process.cwd(), 'output-tests');

// Mock generator client to bypass env and external deps
vi.mock('../src/integration/generatorClient.ts', () => {
  return {
    generateEaziPayWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 5);
      const header = 'AccountName,AccountNumber,SortCode,Amount,sunNumber,sunName';
      const body = Array.from({ length: rows }, (_, i) => `Name${i+1},1234567${i},12-34-5${i},${(i+1)*1.11.toFixed(2)},${opts?.originating?.sunNumber ?? ''},${opts?.originating?.sunName ?? ''}`);
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
import Fastify, { FastifyInstance } from 'fastify';
import formBody from '@fastify/formbody';
// Import dynamically after env is set
import path from 'path';
import { jobManager } from '../src/jobs/jobManager.js';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formBody);
  process.env.SYNC_ROW_LIMIT = '10';
  process.env.OUTPUT_ROOT = path.resolve(process.cwd(), 'output-tests');
  process.env.GENERATOR_ENTRY = path.resolve(__dirname, 'helpers', 'generator.stub.ts');
  return app;
}

describe('async jobs', () => {
  it('enqueues job when rows exceed sync limit', async () => {
    const app = buildApp();
    const { registerGenerateRoute } = await import('../src/routes/generate.js');
    await registerGenerateRoute(app);
    await (await import('../src/jobs/jobManager.js')).jobManager.init();
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 25 } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    const job = jobManager.get(body.jobId);
    expect(job?.state === 'pending' || job?.state === 'running').toBe(true);
  }, 10000);

  it('job completes and can be polled', async () => {
    const app = buildApp();
    const { registerGenerateRoute } = await import('../src/routes/generate.js');
    await registerGenerateRoute(app);
    await (await import('../src/jobs/jobManager.js')).jobManager.init();
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 25 } });
    const jobId = res.json().jobId as string;
    for (let i = 0; i < 400; i++) {
      const statusRes = await app.inject({ method: 'GET', url: `/jobs/${jobId}` });
      const status = statusRes.json();
      if (status.state === 'completed') {
        expect(status.progress).toBe(100);
        return;
      }
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('Job did not complete in expected timeframe');
  }, 15000);
});
// Mock report API client to bypass DDICA external generation
vi.mock('../src/integration/reportApiClient.ts', () => {
  return {
    generateDdicaWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 3);
      const xmlContent = `<DDICA>${Array.from({ length: rows }, (_, i) => `<Row><SeqNo>${i + 1}</SeqNo></Row>`).join('')}</DDICA>`;
      return { xmlContent, checksumSha256: 'stub', rows, filename: 'DDICA.xml', xmlPath: 'DDICA.xml' };
    },
  };
});
// Match runtime ESM import with .js extension
vi.mock('../src/integration/generatorClient.js', () => {
  return {
    generateEaziPayWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 5);
      const header = 'AccountName,AccountNumber,SortCode,Amount,sunNumber,sunName';
      const body = Array.from({ length: rows }, (_, i) => `Name${i+1},1234567${i},12-34-5${i},${(i+1)*1.11.toFixed(2)},${opts?.originating?.sunNumber ?? ''},${opts?.originating?.sunName ?? ''}`);
      const csvContent = [header, ...body].join('\n');
      return { csvContent, checksumSha256: 'stub', rows, filename: `EaziPay-${rows}.csv` };
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
// Mock using specifier as used inside jobManager (../integration/*)
vi.mock('../integration/generatorClient.js', () => {
  return {
    generateEaziPayWithRetry: async (_url: string | undefined, opts: any) => {
      const rows = Number(opts?.rows ?? 5);
      const header = 'AccountName,AccountNumber,SortCode,Amount,sunNumber,sunName';
      const body = Array.from({ length: rows }, (_, i) => `Name${i+1},1234567${i},12-34-5${i},${(i+1)*1.11.toFixed(2)},${opts?.originating?.sunNumber ?? ''},${opts?.originating?.sunName ?? ''}`);
      const csvContent = [header, ...body].join('\n');
      return { csvContent, checksumSha256: 'stub', rows, filename: `EaziPay-${rows}.csv` };
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