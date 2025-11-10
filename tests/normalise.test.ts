import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/shared/config.js';

// For now we exercise config loader fallback and actual file presence

describe('config loader', () => {
  it('loads defaults.json and returns syncRowLimit from env override', async () => {
    process.env.SYNC_ROW_LIMIT = '1234';
    const cfg = await loadConfig();
    expect(cfg.syncRowLimit).toBe(1234);
    expect(cfg.defaults.originatingAccount.sortCode).toBe('401726');
  });
});
