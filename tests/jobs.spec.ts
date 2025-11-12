import { describe, it, expect, beforeAll } from 'vitest';
import { jobManager } from '../src/jobs/jobManager.js';
import { jobStore } from '../src/jobs/jobStore.js';
import path from 'path';
import { promises as fs } from 'fs';

// Basic persistence lifecycle test.
describe('JobStore persistence', () => {
  const tempRoot = path.join(process.cwd(), 'tmp-jobstore-tests');
  const storeDir = path.join(tempRoot, 'jobs-store');
  const outputRoot = path.join(tempRoot, 'jobs-artifacts');

  beforeAll(async () => {
    process.env.OUTPUT_ROOT = outputRoot; // picked up by loadConfig in jobManager.init
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    await jobStore.init({ dir: storeDir }); // explicit init for direct calls
    await jobManager.init();
  });

  it('persists job records across state transitions', async () => {
    const job = jobManager.enqueue({ fileTypes: ['EaziPay'], rows: 3, seed: 1234 });
  // Depending on event loop timing the job may transition to 'running' immediately after enqueue.
  expect(['pending','running']).toContain(job.state);
    // Wait for completion (poll simplistic)
    for (let i = 0; i < 200; i++) {
      const j = jobManager.get(job.id)!;
      if (j.state === 'completed') break;
      await new Promise(r => setTimeout(r, 15));
    }
    const final = jobManager.get(job.id)!;
    expect(final.state).toBe('completed');
    // Reload from disk
    // Allow slight delay for final persistence write.
    let loaded = await jobStore.load(job.id);
    if (loaded && loaded.state !== 'completed') {
      await new Promise(r => setTimeout(r, 50));
      loaded = await jobStore.load(job.id);
    }
    expect(loaded).toBeDefined();
    expect(['completed','running']).toContain(loaded!.state);
    expect(loaded!.progress).toBe(100);
    expect(loaded!.output?.filenames[0]).toContain('EaziPay');
  });
});
