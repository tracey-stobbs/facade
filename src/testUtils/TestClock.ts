export interface Clock {
  now(): number;
}

export class TestClock implements Clock {
  private current: number;
  constructor(start: number = Date.now()) { this.current = start; }
  now(): number { return this.current; }
  advance(ms: number): void { this.current += ms; }
}

export class FixedClock implements Clock {
  constructor(private fixed: number) {}
  now(): number { return this.fixed; }
}

export class SystemClock implements Clock {
  now(): number { return Date.now(); }
}
