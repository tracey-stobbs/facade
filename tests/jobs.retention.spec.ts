import { describe, it, expect } from 'vitest';
import { jobManager } from '../src/jobs/jobManager.js';

describe('retention sweeper', () => {
  it('deletes jobs older than retention', async () => {
    process.env.JOB_RETENTION_DAYS = '0';
    await jobManager.init();
    // Enqueue a job and mark it as completed artificially
  const job = jobManager.enqueue({ fileTypes: ['Test'], rows: 1 });
  // Simulate completed job older than retention with dummy output artifacts
  (job as any).state = 'completed';
  (job as any).finishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  (job as any).output = { filenames: ['dummy.csv'], zipPath: 'dummy.zip', metadataPath: 'dummy.metadata.json' };
    await (jobManager as any).sweep();
    const still = jobManager.get(job.id);
    expect(still).toBeUndefined();
  });
});
