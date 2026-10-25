export interface CliRunRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
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
