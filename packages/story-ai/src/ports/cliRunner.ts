// The one place a provider reaches for a program on this machine. The provider sees only what it
// wrote to stdin and what came back on stdout and stderr.
export interface CliRunRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
  // Name prefixes of variables the child must not inherit, whatever the parent's environment holds.
  readonly withoutEnvironment: readonly string[];
  readonly onStdoutLine?: (line: string) => void;
  readonly signal?: AbortSignal;
}

export type CliRunFailure = 'not-found' | 'timeout' | 'aborted';

export interface CliRunResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly failure?: CliRunFailure;
}

export interface ICliRunner {
  readonly run: (request: CliRunRequest) => Promise<CliRunResult>;
}
