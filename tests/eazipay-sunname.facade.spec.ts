import { describe, it, expect } from 'vitest';
import { app, start } from '../src/server.js';
import { promises as fs } from 'fs';
import path from 'path';

async function waitForJobCompletion(jobId: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await app.inject({ method: 'GET', url: `/jobs/${jobId}/status` });
    const body = JSON.parse(String(res.body));
    if (body.state === 'completed') return;
    if (body.state === 'failed') throw new Error(`Job failed: ${JSON.stringify(body.error)}`);
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Timeout waiting for job completion');
}

describe('Facade integration: SUN Name propagation to EaziPay CSV', () => {
  it('writes supplied sunName into column 11 for all rows', async () => {
    process.env.VITEST = '1';
    await start();
    const sunName = 'SUN-C-0QZ5A';
    const payload = {
      fileTypes: ['EaziPay'],
      rows: 5,
      sun: {
        sunNumber: '797154',
        sunName,
        sortCode: '912291',
        accountNumber: '51491194',
        accountName: 'hOLDER-2W2',
      },
    };
    const res = await app.inject({ method: 'POST', url: '/jobs', payload });
    expect(res.statusCode).toBe(202);
    const job = JSON.parse(String(res.body));
    const jobId = job.jobId as string;
    expect(jobId && jobId.length > 0).toBe(true);

    await waitForJobCompletion(jobId);
    const summary = await app.inject({ method: 'GET', url: `/jobs/${jobId}/summary` });
    expect(summary.statusCode).toBe(200);
    const summaryBody = JSON.parse(String(summary.body));
    const folder = summaryBody.fileLocation as string;
    const eazipayName: string = (summaryBody.artifacts.find((a: any) => /EaziPay/.test(a.name))?.name) || `EaziPay-${payload.rows}.csv`;
    const csvPath = path.join(folder, eazipayName);
    const csv = await fs.readFile(csvPath, 'utf8');
    const lines = String(csv).split(/\r?\n/).filter(l => l.length > 0);
    expect(lines.length).toBe(payload.rows);
    for (const line of lines) {
      const fields = line.split(',');
      expect(fields.length).toBeGreaterThanOrEqual(11);
      expect(fields[10]).toBe(sunName);
    }
  });
});
