export async function waitFor(pred: () => boolean, timeout = 5000, interval = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Timeout');
}
