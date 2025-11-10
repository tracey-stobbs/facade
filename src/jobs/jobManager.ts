import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../shared/logger.js';

const logger = createLogger();

export type JobState = 'pending' | 'running' | 'completed' | 'failed';

export interface JobRequest {
  fileTypes: string[];
  rows: number;
  seed?: number;
  processingDate?: string;
}

export interface JobRecord {
  id: string;
  state: JobState;
  request: JobRequest;
  createdAt: string;
  updatedAt: string;
  progress: number; // 0-100
  error?: { code: string; message: string };
  output?: { filename: string; content: string };
}

class JobManager extends EventEmitter {
  private jobs = new Map<string, JobRecord>();
  private concurrency = 2;

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
    this.emit('job-start', job);
    logger.info({ event: 'job.start', id: job.id }, 'Job started');
    try {
      // Simulated stages: build CSV, maybe call external services, finalize.
      await this.stage(job, 20, async () => {/* placeholder */});
      await this.stage(job, 70, async () => {/* placeholder heavy work */});
      // Final output (stub) — integrate generator/report wrappers later.
      const filename = `${job.request.fileTypes[0]}-${job.request.rows}.csv`;
      const content = `header1,header2\nvalue1,value2`; // deterministic stub
      await this.stage(job, 100, async () => {
        job.output = { filename, content };
      });
      job.state = 'completed';
      job.updatedAt = new Date().toISOString();
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
