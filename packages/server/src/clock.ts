/** Injectable clock so time-based business rules are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class ManualClock implements Clock {
  private current: Date;
  constructor(start: Date | string) {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  set(value: Date | string): void {
    this.current = new Date(value);
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
