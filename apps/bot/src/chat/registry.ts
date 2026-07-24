import type { IncomingUpdate } from "./ports"
import type { ChatContext } from "./context"

// Command pattern (AD §5.1, QA-03): each command is an independent handler; the router only
// knows the registry. Adding a command is a new handler + one register() call, no router edits.
export interface ICommandHandler {
  readonly command: string
  readonly description: string
  match(update: IncomingUpdate): boolean
  execute(ctx: ChatContext): Promise<void>
}

export interface IRegisterHandler {
  register(handler: ICommandHandler): void
}

export class CommandRegistry implements IRegisterHandler {
  private readonly handlers: ICommandHandler[] = []

  public register(handler: ICommandHandler): void {
    this.handlers.push(handler)
  }

  public resolve(update: IncomingUpdate): ICommandHandler | undefined {
    return this.handlers.find((handler) => handler.match(update))
  }

  public list(): readonly ICommandHandler[] {
    return this.handlers
  }
}

// Extracts the leading slash command, stripping a `@botname` suffix (Telegram adds it in groups).
export function commandName(update: IncomingUpdate): string | undefined {
  if (update.kind !== "message") {
    return undefined
  }

  const text = update.text.trim()
  if (!text.startsWith("/")) {
    return undefined
  }

  const token = text.split(/\s+/, 1)[0] ?? text
  return token.split("@")[0]
}

export function isCommand(update: IncomingUpdate, name: string): boolean {
  return commandName(update) === name
}

// Returns the text after the command token, or "" for a bare command / non-command update.
export function commandArgs(update: IncomingUpdate): string {
  if (update.kind !== "message") {
    return ""
  }

  const text = update.text.trim()
  const firstSpace = text.search(/\s/)
  return firstSpace === -1 ? "" : text.slice(firstSpace + 1).trim()
}
