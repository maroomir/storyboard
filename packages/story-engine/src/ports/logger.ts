export interface IStoryboardLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  show(): void;
}
