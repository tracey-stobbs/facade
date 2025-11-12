import { afterAll, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
// Direct job artifacts directory (facade output root) left in place during tests to avoid race conditions.
const E2E_PREFIXES = [
  'tmp-e2e-smoke',
  'tmp-e2e-smoke-ddica'
];

async function safeRm(target: string): Promise<void> {
  try { await fs.rm(target, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function cleanupE2E(): Promise<void> {
  const entries = await fs.readdir(ROOT).catch(() => []);
  await Promise.all(entries
    .filter(e => E2E_PREFIXES.some(p => e.startsWith(p)))
    .map(e => safeRm(path.join(ROOT, e))));
}

// Only clean e2e smoke artifacts after all tests; avoid deleting jobStore directories mid-run.
afterAll(async () => { await cleanupE2E(); });
