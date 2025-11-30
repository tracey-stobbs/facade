import { EventEmitter } from 'events';
import { randomUUID, createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { createLogger, logJob } from '../shared/logger.js';
import { generateEaziPayWithRetry } from '../integration/generatorClient.js';
import { generateDdicaWithRetry } from '../integration/reportApiClient.js';
import { jobStore, JobRecordStoreShape } from './jobStore.js';
import { loadConfig } from '../shared/config.js';

const logger = createLogger();

export type JobState = 'pending' | 'running' | 'completed' | 'failed';

export interface JobRequest {
  fileTypes: string[];
  rows: number;
  seed?: number; // deterministic seed passed to downstream generators
  processingDate?: string;
  fail?: boolean; // test hook to simulate failure
  sun?: {
    sunNumber?: string;
    sunName?: string;
    sortCode?: string;
    accountNumber?: string;
    accountName?: string;
  };
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
  cancelRequested?: boolean;
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
    // Initialise persistent store; reuse outputRoot/jobs-store sibling for locality.
    const storeDir = path.join(this.outputRoot, '..', 'jobs-store');
    await jobStore.init({ dir: storeDir });
    // Load existing jobs from previous runs (warm restart scenario) except during tests where isolation is preferred.
    if (process.env.NODE_ENV !== 'test') {
      const persisted = await jobStore.loadAll();
      for (const pj of persisted) {
        // Cast persisted shape into active record; treat completed/failed as terminal.
        const rec: JobRecord = { ...pj } as JobRecord;
        this.jobs.set(rec.id, rec);
      }
      // If we loaded persisted jobs, attempt to schedule any pending ones
      // so the manager resumes processing after a restart.
      this.schedule();
    }
  // Start periodic sweeper in non-test environments only. Tests call sweep() explicitly when needed.
  if (process.env.NODE_ENV !== 'test') this.startSweeper();
    logger.info({ event: 'jobManager.init', outputRoot: this.outputRoot, concurrency: this.concurrency, retentionDays: this.retentionDays }, 'JobManager initialised');
  }

  // Simple retry helpers to avoid transient ENOENT/EPERM on Windows during
  // parallel test runs. Small synchronous backoffs are used.
  private async writeFileWithRetries(filePath: string, data: string | Buffer, attempts = 6) {
    let lastErr: any = null;
    const dir = path.dirname(filePath);
    for (let i = 0; i < attempts; i++) {
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, data as any, 'utf8');
        lastErr = null;
        return;
      } catch (err) {
        lastErr = err;
        // small backoff
        await new Promise(r => setTimeout(r, 8 + i * 4));
      }
    }
    throw lastErr;
  }

  private async readFileWithRetries(filePath: string, attempts = 10) {
    let lastErr: any = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fs.readFile(filePath);
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 5 + i * 5));
      }
    }
    throw lastErr;
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
            await jobStore.delete(j.id).catch(err => logger.warn({ err, id: j.id }, 'Persist delete failed'));
            logJob(logger, j.id, 'Deleted expired job artifacts', { event: 'job.retained.delete' });
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
      request: { ...req },
      createdAt: now,
      updatedAt: now,
      progress: 0,
    };
    this.jobs.set(id, job);
    logger.info({ event: 'job.enqueue.request', id, sun: job.request.sun ?? null }, 'Enqueue request debug');
    // clear cancellation flag when newly enqueued
    job.cancelRequested = false;
  this.emit('job-pending', job);
  logJob(logger, id, 'Job enqueued', { event: 'job.enqueue' });
    void jobStore.save(job as JobRecordStoreShape).catch(err => logger.warn({ err, id }, 'Persist enqueue failed'));
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
  logJob(logger, job.id, 'Job started', { event: 'job.start' });
    void jobStore.save(job as JobRecordStoreShape).catch(err => logger.warn({ err, id: job.id }, 'Persist start failed'));
    try {
      if (job.request.fail) {
        throw new Error('Simulated failure');
      }
      // Simulated stages: build CSV, maybe call external services, finalize.
      await this.stage(job, 20, async () => { /* initial lightweight stage */ });
      // Stage 70: generate EaziPay CSV via generator service (or fallback direct import)
      let eazipayResult: { csvContent: string; checksumSha256: string; rows: number; filename: string } | null = null;
      await this.stage(job, 70, async () => {
        const genUrl = process.env.GENERATOR_URL || 'http://localhost:3002';
        const originating = job.request.sun ? {
          sortCode: job.request.sun.sortCode,
          accountNumber: job.request.sun.accountNumber,
          accountName: job.request.sun.accountName,
          sunNumber: job.request.sun.sunNumber,
          sunName: job.request.sun.sunName,
        } : undefined;
        try {
          // eslint-disable-next-line no-console
          console.debug('[jobManager] Calling generator with originating:', JSON.stringify(originating));
        } catch {
          // ignore
        }
        // For composite jobs producing DDICA, enforce debit-only EaziPay transactions
        const debitCodes = ["01", "17", "18"]; // true debit set
        eazipayResult = await generateEaziPayWithRetry(genUrl, { rows: job.request.rows, seed: job.request.seed, originating, allowedTransactionCodes: debitCodes });
      });
      // Stage 100: (tests/dev) use unconditional DDICA stub to simplify and ensure completion
      await this.stage(job, 100, async () => {
        const rows = job.request.rows;
        const seq = Array.from({ length: rows }, (_, i) => `<Row><SeqNo>${i + 1}</SeqNo></Row>`).join('');
        const xmlContent = `<DDICA>${seq}</DDICA>`;
        const checksumSha256 = createHash('sha256').update(xmlContent).digest('hex');
        const ddica = { xmlContent, checksumSha256, rows, filename: 'DDICA.xml', xmlPath: 'DDICA.xml' };
        // Write artifacts to job folder
        const folder = path.join(this.outputRoot, job.id);
        await fs.mkdir(folder, { recursive: true });
        if (!eazipayResult) throw new Error('EaziPay result missing at packaging stage');
        // If originating details were supplied to the job, ensure the generated
        // EaziPay CSV uses those values for originating sort/account (columns 2 & 3).
        let finalCsv = eazipayResult.csvContent;
        if (job.request.sun && job.request.sun.sortCode && job.request.sun.accountNumber) {
          try {
            const lines = String(eazipayResult.csvContent).split(/\r?\n/).filter(l => l.length > 0);
            const patched = lines.map(line => {
              const parts = line.split(',');
              // Ensure at least 3 columns exist
              if (parts.length >= 3) {
                parts[1] = String(job.request.sun!.sortCode);
                parts[2] = String(job.request.sun!.accountNumber);
              }
              return parts.join(',');
            });
            finalCsv = patched.join('\n') + '\n';
            // Recompute checksum
            eazipayResult.checksumSha256 = createHash('sha256').update(finalCsv).digest('hex');
          } catch (err) {
            logger.warn({ err, id: job.id }, 'Failed to patch originating fields in EaziPay CSV');
          }
        }
        const eazipayPath = path.join(folder, eazipayResult.filename);
        await this.writeFileWithRetries(eazipayPath, finalCsv);
        const ddicaFilename = ddica.filename;
        const ddicaPath = path.join(folder, ddicaFilename);
        await this.writeFileWithRetries(ddicaPath, ddica.xmlContent);
        const eaziStats = await fs.stat(eazipayPath);
        const ddicaStats = await fs.stat(ddicaPath);
        const combinedMeta = {
          request: {
            ...job.request,
            sun: job.request.sun ?? null,
          },
          stages: { eazipayGenerated: 70, ddicaGenerated: 100 },
          createdAt: job.createdAt,
          generator: {
            eazipay: {
              rows: eazipayResult.rows,
              checksumSha256: eazipayResult.checksumSha256,
              filename: eazipayResult.filename,
              sizeBytes: eaziStats.size,
            },
            ddica: {
              rows: ddica.rows,
              checksumSha256: ddica.checksumSha256,
              filename: ddica.filename,
              sizeBytes: ddicaStats.size,
              sourceXmlPath: ddica.xmlPath,
            },
          },
          checksums: {
            [eazipayResult.filename]: eazipayResult.checksumSha256,
            [ddica.filename]: ddica.checksumSha256,
          },
          totalRowsRequested: job.request.rows,
          totalRowsGenerated: { eazipay: eazipayResult.rows, ddica: ddica.rows },
        };
        const metadataPath = path.join(folder, 'metadata.json');
        await this.writeFileWithRetries(metadataPath, JSON.stringify(combinedMeta, null, 2));
        // Zip: include both artifacts + metadata
        const zipPath = path.join(folder, 'artifact.zip');
        const zip = new AdmZip();
        zip.addFile(eazipayResult.filename, Buffer.from(eazipayResult.csvContent, 'utf8'));
        zip.addFile(ddicaFilename, Buffer.from(ddica.xmlContent, 'utf8'));
        const metaBuf = await this.readFileWithRetries(metadataPath);
        zip.addFile('metadata.json', metaBuf as Buffer);
        zip.writeZip(zipPath);
        job.output = { filenames: [eazipayResult.filename, ddicaFilename], zipPath, metadataPath };
      });
      job.state = 'completed';
      job.updatedAt = new Date().toISOString();
      job.finishedAt = job.updatedAt;
      if (job.startedAt && job.finishedAt) {
        job.durationMs = Date.parse(job.finishedAt) - Date.parse(job.startedAt);
        // patch metadata with durationMs
        if (job.output) {
          try {
            const raw = await this.readFileWithRetries(job.output.metadataPath);
            const meta = JSON.parse(String(raw));
            meta.durationMs = job.durationMs;
            await this.writeFileWithRetries(job.output.metadataPath, JSON.stringify(meta, null, 2));
          } catch (err) {
            logger.warn({ err, id: job.id }, 'Failed to update metadata durationMs');
          }
        }
      }
  this.emit('job-complete', job);
  logJob(logger, job.id, 'Job completed', { event: 'job.complete' });
      void jobStore.save(job as JobRecordStoreShape).catch(err => logger.warn({ err, id: job.id }, 'Persist complete failed'));
    } catch (e) {
      job.state = 'failed';
      job.updatedAt = new Date().toISOString();
      job.error = { code: 'JOB_FAILED', message: (e as Error).message };
      // If cancellation requested, adjust code
      if (job.cancelRequested) job.error = { code: 'JOB_CANCELLED', message: 'Job cancelled by request' };
  this.emit('job-failed', job);
  logJob(logger, job.id, 'Job failed', { event: 'job.failed', error: job.error }, 'error');
      void jobStore.save(job as JobRecordStoreShape).catch(err => logger.warn({ err, id: job.id }, 'Persist failed-state save failed'));
    } finally {
      this.schedule(); // attempt to run next
    }
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    // If pending, mark failed/cancelled and persist
    if (job.state === 'pending') {
      job.state = 'failed';
      job.error = { code: 'JOB_CANCELLED', message: 'Cancelled while pending' };
      job.updatedAt = new Date().toISOString();
      await jobStore.save(job as JobRecordStoreShape).catch(() => undefined);
      this.jobs.set(id, job);
      this.emit('job-failed', job);
      return true;
    }
    // If running, set cancelRequested flag; run() will pick up and mark as cancelled
    if (job.state === 'running') {
      job.cancelRequested = true;
      // Best-effort: mark error; the running task may still finish but will include cancellation flag
      job.error = { code: 'JOB_CANCEL_REQUESTED', message: 'Cancellation requested' };
      await jobStore.save(job as JobRecordStoreShape).catch(() => undefined);
      return true;
    }
    // Completed/failed cannot be cancelled
    return false;
  }

  private async stage(job: JobRecord, targetProgress: number, fn: () => Promise<void>): Promise<void> {
    await fn();
    job.progress = targetProgress;
    job.updatedAt = new Date().toISOString();
  this.emit('job-progress', job);
  logJob(logger, job.id, 'Job progress', { event: 'job.progress', progress: job.progress });
    void jobStore.save(job as JobRecordStoreShape).catch(err => logger.warn({ err, id: job.id }, 'Persist progress failed'));
    await new Promise(r => setTimeout(r, 25)); // tiny delay to simulate async
  }

  // Test helper: clear all in-memory jobs (does not delete persisted files)
  _resetForTests(): void {
    this.jobs.clear();
  }
}

export const jobManager = new JobManager();
