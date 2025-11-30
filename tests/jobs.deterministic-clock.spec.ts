import { describe, it, expect, vi } from 'vitest';
import { jobManager } from '../src/jobs/jobManager.js';
import { TestClock } from '../src/testUtils/TestClock.js';
import { waitFor } from '../src/testUtils/waitFor.js';

// Deterministic completion test using fake timers + TestClock

describe('JobManager deterministic completion (TD-016)', () => {
  it('completes a job without real-time delays using fake timers', async () => {
    vi.useFakeTimers();
    // Inject clock by monkeypatching Date.now during test scope
    const clock = new TestClock(1_000_000); // arbitrary fixed start
    const originalNow = Date.now;
    // @ts-expect-error override for test determinism
    Date.now = () => clock.now();

    await jobManager.init();
    const job = jobManager.enqueue({ fileTypes: ['EaziPay'], rows: 1, seed: 42 });

    // Progress stages use setTimeout small delays; advance timers proactively
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100); // simulate passage
      clock.advance(100); // advance deterministic clock
      const rec = jobManager.get(job.id);
      if (rec?.state === 'completed') break;
    }

    await waitFor(() => jobManager.get(job.id)?.state === 'completed', 2000, 25);
    const finished = jobManager.get(job.id);
    expect(finished?.state).toBe('completed');
    expect(finished?.progress).toBe(100);

    // Restore Date.now
    // @ts-expect-error restore
    Date.now = originalNow;
    vi.useRealTimers();
  }, 5000);
});
