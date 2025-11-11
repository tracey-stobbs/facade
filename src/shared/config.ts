import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

export interface OriginatingAccount {
  sortCode: string;
  accountNumber: string;
  accountName?: string;
  accountType?: 'C' | 'S';
}

export interface DefaultsConfig {
  originatingAccount: OriginatingAccount;
}

export interface AppConfig {
  defaults: DefaultsConfig;
  syncRowLimit: number;
  jobRetentionDays: number;
  maxConcurrentJobs: number;
  outputRoot: string; // root directory for persisted job artifacts/zips
}

const logger = createLogger();

const DEFAULTS_FALLBACK: DefaultsConfig = {
  originatingAccount: {
    sortCode: '000000',
    accountNumber: '00000000',
    accountName: 'DEFAULT',
    accountType: 'C'
  }
};

export async function loadConfig(): Promise<AppConfig> {
  const syncRowLimit = Number(process.env.SYNC_ROW_LIMIT || 5000);
  const jobRetentionDays = Number(process.env.JOB_RETENTION_DAYS || 7);
  const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS || 4);
  const outputRoot = process.env.OUTPUT_ROOT ? path.resolve(process.env.OUTPUT_ROOT) : path.join(process.cwd(), 'jobs');
  const defaultsPath = path.join(process.cwd(), 'config', 'defaults.json');
  let defaults: DefaultsConfig = DEFAULTS_FALLBACK;
  try {
    const raw = await fs.readFile(defaultsPath, 'utf8');
    defaults = JSON.parse(raw) as DefaultsConfig;
  } catch (err) {
    logger.warn({ err, defaultsPath }, 'defaults.json missing or unreadable; using fallback');
  }
  return { defaults, syncRowLimit, jobRetentionDays, maxConcurrentJobs, outputRoot };
}
