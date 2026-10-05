import { measureWidth, truncateToWidth } from '@/terminal/width';

// stderr 맨 아래 몇 줄을 제자리에서 다시 그리는 자리. 진행 레일이 여기 그려지고, 그 사이에
// 나오는 경고·오류 줄은 레일을 지운 뒤 위에 쓰고 레일을 다시 그린다 — 둘이 섞여 깨지지 않게.

export interface LiveAreaStream {
  readonly write: (text: string) => unknown;
}

export class LiveArea {
  private lines: readonly string[] = [];

  // The width is read on every draw, so a window resized during a run is measured as it is now.
  public constructor(
    private readonly stream: LiveAreaStream,
    private readonly readColumns: () => number,
  ) {}

  public show(lines: readonly string[]): void {
    this.erase();
    const columns = this.readColumns();
    // A line as wide as the screen would wrap and the erase would miss its second row.
    this.lines = lines.map((line) =>
      measureWidth(line) < columns ? line : truncateToWidth(line, columns - 1),
    );
    this.draw();
  }

  // Writes text that stays on the screen, above the live lines.
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

  // Back to the first column (a `^C` echo moves the cursor), up over the rows the lines take now
  // (a narrowed window wraps them), then clear to the end of the screen.
  private erase(): void {
    if (this.lines.length === 0) {
      return;
    }

    const columns = Math.max(1, this.readColumns());
    const rows = this.lines.reduce(
      (total, line) => total + Math.max(1, Math.ceil(measureWidth(line) / columns)),
      0,
    );
    this.stream.write(`\r\u001b[${rows}A\u001b[0J`);
  }
}
