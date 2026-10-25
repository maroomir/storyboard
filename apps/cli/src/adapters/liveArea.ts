import { measureWidth, truncateToWidth } from '@/terminal/width';

export const liveAreaReservedColumns: number = 1;

export interface LiveAreaStream {
  readonly write: (text: string) => unknown;
}

export class LiveArea {
  private lines: readonly string[] = [];

  public constructor(
    private readonly stream: LiveAreaStream,
    private readonly readColumns: () => number,
  ) {}

  public show(lines: readonly string[]): void {
    this.erase();
    const columns: number = this.readColumns();
    this.lines = lines.map((line) =>
      measureWidth(line) < columns
        ? line
        : truncateToWidth(line, columns - liveAreaReservedColumns),
    );
    this.draw();
  }

  public writeAbove(text: string): void {
    this.erase();
    this.stream.write(text);
    this.draw();
  }

  public clear(): void {
    this.erase();
    this.lines = [];
  }

  private draw(): void {
    if (this.lines.length > 0) {
      this.stream.write(`${this.lines.join('\n')}\n`);
    }
  }

  private erase(): void {
    if (this.lines.length === 0) {
      return;
    }

    const columns: number = Math.max(1, this.readColumns());
    const rows: number = this.lines.reduce(
      (total, line) => total + Math.max(1, Math.ceil(measureWidth(line) / columns)),
      0,
    );
    this.stream.write(`\r\u001b[${rows}A\u001b[0J`);
  }
}
