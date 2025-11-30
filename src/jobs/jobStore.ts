import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../shared/logger.js';
import { AppError, ErrorCodes } from '../shared/errors.js';

// NOTE: Duplicate JobRecord shape locally to avoid circular import. Keep in sync with jobManager.ts.
export interface JobRecordStoreShape {
  id: string;
  state: 'pending' | 'running' | 'completed' | 'failed';
  request: {
    fileTypes: string[];
    rows: number;
    seed?: number;
    processingDate?: string;
    fail?: boolean;
  };
  createdAt: string;
  updatedAt: string;
  progress: number;
  error?: { code: string; message: string };
  output?: { filenames: string[]; zipPath: string; metadataPath: string };
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

interface JobStoreConfig {
  dir: string; // persistent directory for job JSON documents
}

class JobStore {
  private dir: string = path.join(process.cwd(), 'jobs-store');
  private initialised = false;
  private logger = createLogger();

  async init(cfg?: Partial<JobStoreConfig>): Promise<void> {
    if (this.initialised) return; // idempotent
    if (cfg?.dir) this.dir = cfg.dir;
    await fs.mkdir(this.dir, { recursive: true });
    this.initialised = true;
    this.logger.info({ event: 'jobStore.init', dir: this.dir }, 'JobStore initialised');
  }

  private filePath(id: string): string { return path.join(this.dir, `${id}.json`); }

  async save(job: JobRecordStoreShape): Promise<void> {
    if (!this.initialised) throw new AppError(ErrorCodes.JOBSTORE_NOT_INITIALISED, 'JobStore not initialised');
  // Temp file WITHOUT .json extension so loadAll() won't attempt to parse it if a rename fails.
  const tmp = path.join(this.dir, `${job.id}.tmp-${Date.now()}`);
    const finalPath = this.filePath(job.id);
    const data = JSON.stringify(job, null, 2);
    // atomic-ish write: write temp then rename
    await fs.writeFile(tmp, data, 'utf8');
    try {
      await fs.rename(tmp, finalPath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // Windows can intermittently raise EPERM on rapid rename during AV/file indexing.
      // Fallback to a direct write when this occurs to avoid test flakiness.
      if (e.code === 'EPERM') {
        try {
          await fs.writeFile(finalPath, data, 'utf8');
        } finally {
          await fs.rm(tmp, { force: true }).catch(() => undefined);
        }
      } else {
        // Re-throw non-permission errors.
        throw err;
      }
    }
  }

  async load(id: string): Promise<JobRecordStoreShape | undefined> {
    if (!this.initialised) throw new AppError(ErrorCodes.JOBSTORE_NOT_INITIALISED, 'JobStore not initialised');
    try {
      const raw = await fs.readFile(this.filePath(id), 'utf8');
      return JSON.parse(raw) as JobRecordStoreShape;
    } catch { return undefined; }
  }

  async loadAll(): Promise<JobRecordStoreShape[]> {
    if (!this.initialised) throw new AppError(ErrorCodes.JOBSTORE_NOT_INITIALISED, 'JobStore not initialised');
    const entries: JobRecordStoreShape[] = [];
    const files = await fs.readdir(this.dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      // Skip transient temp files that may contain partial JSON content. These
      // are created during the atomic write process and sometimes linger if a
      // rename fails or the process is interrupted. Examples: '<id>.tmp-1234'
      // '<id>.tmp-1234.json'.
      if (f.includes('.tmp-')) continue;
      const abs = path.join(this.dir, f);
      try {
        const stats = await fs.stat(abs).catch(() => null);
        if (!stats || stats.size === 0) {
          // empty file — skip
          continue;
        }
        const raw = await fs.readFile(abs, 'utf8');
        entries.push(JSON.parse(raw));
      } catch (err) {
        this.logger.warn({ err, file: f }, 'Failed to read job file');
      }
    }
    return entries;
  }

  async delete(id: string): Promise<void> {
    if (!this.initialised) throw new AppError(ErrorCodes.JOBSTORE_NOT_INITIALISED, 'JobStore not initialised');
    await fs.rm(this.filePath(id), { force: true });
  }

  // For tests: purge all persisted jobs.
  async clear(): Promise<void> {
    if (!this.initialised) throw new AppError(ErrorCodes.JOBSTORE_NOT_INITIALISED, 'JobStore not initialised');
    const files = await fs.readdir(this.dir).catch(() => []);
    await Promise.all(files.filter(f => f.endsWith('.json')).map(f => fs.rm(path.join(this.dir, f), { force: true })));
  }
}

export const jobStore = new JobStore();
