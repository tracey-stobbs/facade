import { describe, it, expect } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formBody from '@fastify/formbody';
import { registerGenerateRoute } from '../src/routes/generate.js';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formBody);
  process.env.SYNC_ROW_LIMIT = '5';
  return app;
}

// Parse SSE stream body produced by fastify.inject (all events concatenated)
interface SseEvent { event: string; data: unknown }
function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = raw.trim().split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    let evt: string | null = null;
  let data: unknown = null;
    for (const line of lines) {
      if (line.startsWith('event:')) evt = line.slice(6).trim();
      if (line.startsWith('data:')) {
        const json = line.slice(5).trim();
        try { data = JSON.parse(json); } catch { data = json; }
      }
    }
    if (evt) events.push({ event: evt, data });
  }
  return events;
}

describe('SSE events', () => {
  it('emits progress and end events', async () => {
    const app = buildApp();
    await registerGenerateRoute(app);
  const enqueueRes = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 10, seed: 42 } });
  expect(enqueueRes.statusCode).toBe(202);
  const jobId = enqueueRes.json().jobId as string;
  // Connect to SSE immediately so we capture all progress events.
  const sseRes = await app.inject({ method: 'GET', url: `/jobs/${jobId}/events` });
    expect(sseRes.statusCode).toBe(200);
    const events = parseSse(sseRes.body as string);
    const progressEvents = events.filter(e => e.event === 'progress');
    const endEvents = events.filter(e => e.event === 'end');
  expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(endEvents.length).toBe(1);
  const lastProgress = progressEvents[progressEvents.length - 1];
  const progressData = lastProgress.data as { progress: number };
  expect(progressData.progress).toBe(100);
  const endData = endEvents[0].data as { state: string };
  expect(endData.state === 'completed' || endData.state === 'failed').toBe(true);
  });
});