export type ConfigFileErrorCode = 'invalid-json' | 'not-an-object' | 'invalid-value' | 'write-failed';

export class ConfigFileError extends Error {
  public constructor(
    public readonly code: ConfigFileErrorCode,
    public readonly file: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConfigFileError';
  }
}
