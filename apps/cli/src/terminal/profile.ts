import { createTheme, plainTheme, shouldUseColor, type Theme } from './theme';

// stdout 과 stderr 는 따로 판정한다. `storyboard draft show 01-a > out.md` 는 stdout 만 파일이고
// 진행 로그는 여전히 사람이 보는 터미널로 간다.

// What the process knows about its streams before any argument is read.
export interface TerminalStreamFacts {
  readonly isTty: boolean;
  readonly columns?: number;
}

export interface TerminalFacts {
  readonly stdout: TerminalStreamFacts;
  readonly stderr: TerminalStreamFacts;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface TerminalStream {
  // A person reads it, so marks and hints are worth adding; a pipe gets only the result.
  readonly isTty: boolean;
  readonly columns: number;
  readonly theme: Theme;
}

export interface TerminalProfile {
  readonly stdout: TerminalStream;
  readonly stderr: TerminalStream;
}

// A pipe has no width; 80 is what a reader of the piped text most likely has.
export const defaultColumns = 80;

// Tests and the TUI call dispatch without real streams, and get exactly the pre-color output.
export const plainTerminalFacts: TerminalFacts = {
  stdout: { isTty: false },
  stderr: { isTty: false },
  env: {},
};

export interface OutputRequest {
  readonly hasNoColorFlag: boolean;
  readonly isJsonOutput: boolean;
}

export function createTerminalProfile(
  facts: TerminalFacts,
  request: OutputRequest,
): TerminalProfile {
  const describeStream = (stream: TerminalStreamFacts): TerminalStream => ({
    isTty: stream.isTty,
    // Some pseudo terminals report 0 columns; that is "unknown", not a zero-width screen.
    columns: stream.columns !== undefined && stream.columns > 0 ? stream.columns : defaultColumns,
    theme: createTheme(shouldUseColor({ isTty: stream.isTty, env: facts.env, ...request })),
  });

  return { stdout: describeStream(facts.stdout), stderr: describeStream(facts.stderr) };
}

export const plainTerminalStream: TerminalStream = {
  isTty: false,
  columns: defaultColumns,
  theme: plainTheme,
};
