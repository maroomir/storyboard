import { createTheme, plainTheme, shouldUseColor, type Theme } from './theme';

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
  readonly isTty: boolean;
  readonly columns: number;
  readonly theme: Theme;
}

export interface TerminalProfile {
  readonly stdout: TerminalStream;
  readonly stderr: TerminalStream;
}

export const assumedColumnsWithoutTerminal: number = 80;

export const plainTerminalFacts: TerminalFacts = {
  stdout: { isTty: false },
  stderr: { isTty: false },
  env: {},
};

export interface OutputRequest {
  readonly hasNoColorFlag: boolean;
  readonly isJsonOutput: boolean;
}

function hasKnownColumns(
  stream: TerminalStreamFacts,
): stream is TerminalStreamFacts & { readonly columns: number } {
  return stream.columns !== undefined && stream.columns > 0;
}

export function createTerminalProfile(
  facts: TerminalFacts,
  request: OutputRequest,
): TerminalProfile {
  const isDumbTerminal: boolean = facts.env.TERM === 'dumb';
  const describeStream = (stream: TerminalStreamFacts): TerminalStream => ({
    isTty: stream.isTty && !isDumbTerminal,
    columns: hasKnownColumns(stream) ? stream.columns : assumedColumnsWithoutTerminal,
    theme: createTheme(shouldUseColor({ isTty: stream.isTty, env: facts.env, ...request })),
  });

  return { stdout: describeStream(facts.stdout), stderr: describeStream(facts.stderr) };
}

export const plainTerminalStream: TerminalStream = {
  isTty: false,
  columns: assumedColumnsWithoutTerminal,
  theme: plainTheme,
};
