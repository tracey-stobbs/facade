import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { promises as fs } from 'fs';

// Mock external generator/report clients BEFORE importing jobManager to avoid network + retry timers.
vi.mock('../src/integration/generatorClient.js', () => ({
  generateEaziPayWithRetry: async () => ({ csvContent: 'a,b,c\n', checksumSha256: 'sha-eazi', rows: 1, filename: 'EaziPay-1.csv' })
}));
vi.mock('../src/integration/reportApiClient.js', () => ({
  generateDdicaWithRetry: async () => ({ xmlContent: '<ddica/>', checksumSha256: 'sha-ddica', rows: 1, filename: 'DDICA-1.xml', xmlPath: 'ddica.xml' })
}));

import { jobManager } from '../src/jobs/jobManager.js';

// Deterministic completion test (TD-016)
// Use real timers; mocks make stage functions immediate except the built-in 25ms delays.
// This avoids complexities of advancing fake timers while real async I/O (fs) completes.

describe('JobManager deterministic completion (TD-016)', () => {
  it('completes a job quickly with mocked external dependencies', async () => {
    const tempRoot = path.join(process.cwd(), 'tmp-jobstore-tests', 'deterministic');
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    const outputRoot = path.join(tempRoot, 'out');
    process.env.OUTPUT_ROOT = outputRoot;
    process.env.JOB_RETENTION_DAYS = '0';
    await jobManager.init();
    const completion = new Promise<void>(resolve => jobManager.once('job-complete', () => resolve()));
    const job = jobManager.enqueue({ fileTypes: ['EaziPay'], rows: 1, seed: 42 });
    await completion; // wait for natural completion
    const finished = jobManager.get(job.id);
    expect(finished?.state).toBe('completed');
    expect(finished?.progress).toBe(100);
  }, 3000);
});
