// What the engine needs from a host's log sink. The extension backs it with a VSCode output
// channel, the bot and the CLI with stderr; none of that is the engine's business.
export interface StoryboardLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  // Bring the log to the user's attention after an operation they cannot otherwise inspect. A host
  // whose log is already on screen — a CLI writing to stderr — implements this as a no-op.
  show(): void;
}
