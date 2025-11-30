import { describe, it, expect, beforeAll } from 'vitest';
import { jobManager } from '../src/jobs/jobManager.js';
import { jobStore } from '../src/jobs/jobStore.js';
import path from 'path';
import { promises as fs } from 'fs';
import { waitFor } from '../src/testUtils/waitFor.js';

describe('Retention sweeper', () => {
  const tempRoot = path.join(process.cwd(), 'tmp-retention-tests');
  const outputRoot = path.join(tempRoot, 'jobs-artifacts');
  const storeDir = path.join(tempRoot, 'jobs-store');

  beforeAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    process.env.OUTPUT_ROOT = outputRoot;
    process.env.JOB_RETENTION_DAYS = '0'; // immediate expiry
    await jobStore.init({ dir: storeDir });
    await jobManager.init();
  });

  it('removes expired completed jobs from memory and persistence', async () => {
    const job = jobManager.enqueue({ fileTypes: ['EaziPay'], rows: 1 });
    await waitFor(() => jobManager.get(job.id)?.state === 'completed', 3000, 15);
    const rec = jobManager.get(job.id)!;
    expect(rec.state).toBe('completed');
    // Artificially age the job
    rec.finishedAt = new Date(Date.now() - 86_400_000).toISOString();
  // Access private method for deterministic sweep invocation in test context
  await (jobManager as any).sweep();
    expect(jobManager.get(job.id)).toBeUndefined();
    const persisted = await jobStore.load(job.id);
    expect(persisted).toBeUndefined();
  });
});