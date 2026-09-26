const SECOND_MS = 1000;
const REQUESTS_PER_SECOND = 15;
const REQUEST_INTERVAL_MS = Math.ceil(SECOND_MS / REQUESTS_PER_SECOND);
const INPUT_BYTES_PER_SECOND = 200_000;

type Clock = { now: () => number; sleep: (milliseconds: number) => Promise<void> };
const SYSTEM_CLOCK: Clock = {
  now: Date.now,
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

export class RequestScheduler {
  private queue: Promise<void> = Promise.resolve();
  private availableAt = 0;
  private recent: { time: number; bytes: number }[] = [];

  constructor(private readonly clock: Clock = SYSTEM_CLOCK) {}

  now(): number {
    return this.clock.now();
  }

  pause(milliseconds: number): void {
    this.availableAt = Math.max(this.availableAt, this.clock.now() + milliseconds);
  }

  acquire(bytes: number): Promise<void> {
    const turn = this.queue.then(() => this.waitForCapacity(bytes));
    this.queue = turn.catch(() => {});
    return turn;
  }

  private async waitForCapacity(bytes: number): Promise<void> {
    while (true) {
      const now = this.clock.now();
      this.recent = this.recent.filter((entry) => entry.time + SECOND_MS > now);
      const used = this.recent.reduce((total, entry) => total + entry.bytes, 0);
      const oldest = this.recent[0];
      const budgetWait = oldest && used + bytes > INPUT_BYTES_PER_SECOND ? oldest.time + SECOND_MS - now : 0;
      const wait = Math.max(this.availableAt - now, budgetWait);
      if (wait > 0) {
        await this.clock.sleep(wait);
        continue;
      }
      this.recent.push({ time: now, bytes });
      const oversizedDelay = bytes > INPUT_BYTES_PER_SECOND ? Math.ceil(bytes / INPUT_BYTES_PER_SECOND) * SECOND_MS : 0;
      this.availableAt = now + Math.max(REQUEST_INTERVAL_MS, oversizedDelay);
      return;
    }
  }
}
