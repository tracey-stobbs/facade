/**
 * Async utility to wait for a predicate to become true, polling at intervals.
 * Throws after timeout if predicate never returns true.
 */
export async function waitFor(
  predicate: () => boolean,
  timeout = 5000,
  interval = 50,
  description: string = 'condition'
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timeout waiting for ${description} after ${timeout}ms`);
}
