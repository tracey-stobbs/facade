import { EventEmitter } from 'events';
import { randomUUID, createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { createLogger } from '../shared/logger.js';
import { loadConfig } from '../shared/config.js';

const logger = createLogger();

export type JobState = 'pending' | 'running' | 'completed' | 'failed';

export interface JobRequest {
  fileTypes: string[];
  rows: number;
  seed?: number; // deterministic seed passed to downstream generators
  processingDate?: string;
  fail?: boolean; // test hook to simulate failure
}

export interface JobRecord {
  id: string;
  state: JobState;
  request: JobRequest;
  createdAt: string;
  updatedAt: string;
  progress: number; // 0-100
  error?: { code: string; message: string };
  output?: { filenames: string[]; zipPath: string; metadataPath: string };
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

class JobManager extends EventEmitter {
  private jobs = new Map<string, JobRecord>();
  private concurrency = 2;
  private outputRoot: string = path.join(process.cwd(), 'jobs');
  private retentionDays = 7;
  private sweepInterval: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    const cfg = await loadConfig();
    this.concurrency = cfg.maxConcurrentJobs;
    this.outputRoot = cfg.outputRoot;
    this.retentionDays = cfg.jobRetentionDays;
    await fs.mkdir(this.outputRoot, { recursive: true });
  // Start periodic sweeper in non-test environments only. Tests call sweep() explicitly when needed.
  if (process.env.NODE_ENV !== 'test') this.startSweeper();
    logger.info({ event: 'jobManager.init', outputRoot: this.outputRoot, concurrency: this.concurrency, retentionDays: this.retentionDays }, 'JobManager initialised');
  }

  private startSweeper(): void {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    this.sweepInterval = setInterval(() => {
      this.sweep().catch(err => logger.error({ err }, 'Retention sweep failure'));
    }, 60_000); // every minute
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const j of this.jobs.values()) {
      if (j.finishedAt) {
        const finishedTs = Date.parse(j.finishedAt);
        if (finishedTs < cutoff && j.output) {
          try {
            await fs.rm(j.output.zipPath, { force: true });
            await fs.rm(j.output.metadataPath, { force: true });
            this.jobs.delete(j.id);
            logger.info({ event: 'job.retained.delete', id: j.id }, 'Deleted expired job artifacts');
          } catch (err) {
            logger.warn({ err, id: j.id }, 'Failed deleting expired job artifacts');
          }
        }
      }
    }
  }

  enqueue(req: JobRequest): JobRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id,
      state: 'pending',
      request: req,
      createdAt: now,
      updatedAt: now,
      progress: 0,
    };
    this.jobs.set(id, job);
    this.emit('job-pending', job);
    logger.info({ event: 'job.enqueue', id }, 'Job enqueued');
    this.schedule();
    return job;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  list(): JobRecord[] {
    return Array.from(this.jobs.values());
  }

  private runningCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === 'running') n++;
    return n;
  }

  private schedule(): void {
    if (this.runningCount() >= this.concurrency) return;
    const next = Array.from(this.jobs.values()).find(j => j.state === 'pending');
    if (!next) return;
    this.run(next).catch(err => logger.error({ err, id: next.id }, 'Job run failure'));
  }

  private async run(job: JobRecord): Promise<void> {
    job.state = 'running';
    job.updatedAt = new Date().toISOString();
    job.startedAt = job.updatedAt;
    this.emit('job-start', job);
    logger.info({ event: 'job.start', id: job.id }, 'Job started');
    try {
      if (job.request.fail) {
        throw new Error('Simulated failure');
      }
      // Simulated stages: build CSV, maybe call external services, finalize.
      await this.stage(job, 20, async () => { /* placeholder stage 1 */ });
      await this.stage(job, 70, async () => { /* placeholder heavy work */ });
      // Final output (stub) — integrate generator/report wrappers later.
      const filename = `${job.request.fileTypes[0]}-${job.request.rows}.csv`;
      const seedSuffix = job.request.seed != null ? `-${job.request.seed}` : '';
      const content = `header1,header2\nvalue1${seedSuffix},value2`; // deterministic stub including seed
      await this.stage(job, 100, async () => {
        // Write artifacts
        const folder = path.join(this.outputRoot, job.id);
        await fs.mkdir(folder, { recursive: true });
        const filePath = path.join(folder, filename);
        await fs.writeFile(filePath, content, 'utf8');
        const stats = await fs.stat(filePath);
        const checksum = createHash('sha256').update(content).digest('hex');
        const metadata = {
          requestOptions: { fileTypes: job.request.fileTypes, rows: job.request.rows, seed: job.request.seed },
          generatorVersion: 'stub-0.0.1',
          createdAt: job.createdAt,
          durationMs: 0, // placeholder; set after finishedAt
          filenames: [filename],
          fileSizes: { [filename]: stats.size },
          checksums: { [filename]: checksum },
          rowsRequested: job.request.rows,
          rowsGenerated: job.request.rows,
          originatingAccount: { sortCode: '000000', accountNumber: '00000000' },
        };
        const metadataPath = path.join(folder, 'metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  // Real zip packaging: csv + metadata.json at root
  const zipPath = path.join(folder, 'artifact.zip');
  const zip = new AdmZip();
  zip.addFile(filename, Buffer.from(content, 'utf8'));
  const metaBuf = await fs.readFile(metadataPath);
  zip.addFile('metadata.json', metaBuf);
  zip.writeZip(zipPath);
        job.output = { filenames: [filename], zipPath, metadataPath };
      });
      job.state = 'completed';
      job.updatedAt = new Date().toISOString();
      job.finishedAt = job.updatedAt;
      if (job.startedAt && job.finishedAt) {
        job.durationMs = Date.parse(job.finishedAt) - Date.parse(job.startedAt);
        // patch metadata with durationMs
        if (job.output) {
          try {
            const raw = await fs.readFile(job.output.metadataPath, 'utf8');
            const meta = JSON.parse(raw);
            meta.durationMs = job.durationMs;
            await fs.writeFile(job.output.metadataPath, JSON.stringify(meta, null, 2), 'utf8');
          } catch (err) {
            logger.warn({ err, id: job.id }, 'Failed to update metadata durationMs');
          }
        }
      }
      this.emit('job-complete', job);
      logger.info({ event: 'job.complete', id: job.id }, 'Job completed');
    } catch (e) {
      job.state = 'failed';
      job.updatedAt = new Date().toISOString();
      job.error = { code: 'JOB_FAILED', message: (e as Error).message };
      this.emit('job-failed', job);
    } finally {
      this.schedule(); // attempt to run next
    }
  }

  private async stage(job: JobRecord, targetProgress: number, fn: () => Promise<void>): Promise<void> {
    await fn();
    job.progress = targetProgress;
    job.updatedAt = new Date().toISOString();
    this.emit('job-progress', job);
    await new Promise(r => setTimeout(r, 25)); // tiny delay to simulate async
  }
}

export const jobManager = new JobManager();
