export const STATUS_FEEDBACK_INTERVAL_MS = 30_000;

interface FeedbackEntry {
  message: string;
  at: number;
  repeats: number;
}

const pad = (value: number): string => String(value).padStart(2, "0");
export function feedbackTimestamp(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function shouldPaintStatusFeedback(repeated: boolean, now: number, lastPaintedAt: number): boolean {
  return !repeated || now < lastPaintedAt || now - lastPaintedAt >= STATUS_FEEDBACK_INTERVAL_MS;
}

export class FeedbackHistory {
  private readonly entries: FeedbackEntry[] = [];
  constructor(private readonly limit = 100) {}

  add(message: string, at = Date.now()): boolean {
    const last = this.entries[this.entries.length - 1];
    if (last?.message === message) {
      last.at = at;
      last.repeats++;
      return true;
    }
    this.entries.push({ message, at, repeats: 0 });
    if (this.entries.length > this.limit) this.entries.shift();
    return false;
  }

  clear(): void { this.entries.length = 0; }
  get size(): number { return this.entries.length; }
  toText(): string {
    return this.entries.map(({ message, at, repeats }) =>
      `[${feedbackTimestamp(at)}] ${message}${repeats ? ` +${repeats}` : ""}`).join("\n");
  }
}
