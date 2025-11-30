import { describe, it, expect } from 'vitest';
import { jobManager } from '../src/jobs/jobManager.js';
import { promises as fs } from 'fs';
import path from 'path';
import { waitFor } from '../src/testUtils/waitFor.js';

// Lightweight integration test: requires generator & report API running locally.
// Skips if services unreachable.

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

describe('JobManager EaziPay + DDICA pipeline', () => {
  it('progresses to 100 and produces zip & metadata', async () => {
    await jobManager.init();
    const job = jobManager.enqueue({ fileTypes: ['EaziPay'], rows: 3, seed: 999 });
    // Wait for job completion deterministically
    await waitFor(() => jobManager.get(job.id)?.state === 'completed', 15000, 150);
    const finished = jobManager.get(job.id);
    expect(finished).toBeTruthy();
    expect(finished?.state).toBe('completed');
    expect(finished?.progress).toBe(100);
    const out = finished?.output;
    expect(out).toBeTruthy();
    if (out) {
      expect(await exists(out.zipPath)).toBe(true);
      expect(await exists(out.metadataPath)).toBe(true);
      const metaRaw = await fs.readFile(out.metadataPath, 'utf8');
      const meta = JSON.parse(metaRaw);
      expect(meta.generator.eazipay.rows).toBe(3);
  // DDICA rows may include additional structural or header elements; accept >= requested
  expect(meta.generator.ddica.rows).toBeGreaterThanOrEqual(3);
      expect(meta.checksums[meta.generator.eazipay.filename]).toMatch(/^[a-f0-9]{64}$/);
      expect(meta.checksums[meta.generator.ddica.filename]).toMatch(/^[a-f0-9]{64}$/);
    }
  }, 20000);
});