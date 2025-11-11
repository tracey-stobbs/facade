import { afterAll, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const jobsDir = path.join(process.cwd(), 'jobs');

async function removeJobsDir(): Promise<void> {
  try {
    await fs.rm(jobsDir, { recursive: true, force: true });
  } catch (err) {
    // ignore
  }
}

beforeAll(async () => {
  await removeJobsDir();
});

afterAll(async () => {
  await removeJobsDir();
});
