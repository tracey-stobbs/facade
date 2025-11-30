export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now() {
    return Date.now();
  }
}

export class FixedClock implements Clock {
  constructor(private fixed: number) {}
  now() {
    return this.fixed;
  }
}

export class TestClock implements Clock {
  private _now: number;
  constructor(start: number = Date.now()) {
    this._now = start;
  }
  now() {
    return this._now;
  }
  advance(ms: number) {
    this._now += ms;
  }
}
