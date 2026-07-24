export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

// SECURITY: callers must never pass secrets (bot token, API keys) into log messages.
export function createLogger(prefix = "storygram"): Logger {
  const line = (level: string, message: string) =>
    `[${new Date().toISOString()}] [${prefix}] ${level}${message}`

  return {
    info: (message) => console.log(line("", message)),
    warn: (message) => console.warn(line("WARN ", message)),
    error: (message, error) => console.error(line("ERROR ", message), error ?? "")
  }
}
