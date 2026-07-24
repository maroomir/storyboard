// The chat transport contract, owned by the chat core. Only src/telegram/gateway.ts touches grammy;
// it implements these ports, so chat never depends on the Telegram SDK and the transport stays
// swappable and testable. Adapters (telegram/) depend on this file, not the other way around.

export interface InlineButton {
  readonly text: string
  readonly callbackData: string
}

export type InlineKeyboard = readonly (readonly InlineButton[])[]

export interface MessageView {
  readonly text: string
  readonly keyboard?: InlineKeyboard
}

// A single entry in Telegram's native command menu (registered via setMyCommands). `command` is the
// menu name without a leading slash.
export interface BotCommand {
  readonly command: string
  readonly description: string
}

export interface IncomingMessageUpdate {
  readonly kind: "message"
  readonly chatId: number
  readonly userId: number | undefined
  readonly messageId: number
  readonly text: string
}

export interface IncomingCallbackUpdate {
  readonly kind: "callback"
  readonly chatId: number
  readonly userId: number | undefined
  readonly messageId: number
  readonly callbackQueryId: string
  readonly data: string
}

export type IncomingUpdate = IncomingMessageUpdate | IncomingCallbackUpdate

export interface SentMessageRef {
  readonly chatId: number
  readonly messageId: number
}

export interface OutgoingDocument {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly caption?: string
}

// Implemented by TelegramGateway, required by ChatOrchestrator and the job progress reporter.
export interface ISendMessage {
  sendMessage(chatId: number, view: MessageView): Promise<SentMessageRef>
  editMessage(ref: SentMessageRef, view: MessageView): Promise<void>
  answerCallback(callbackQueryId: string, text?: string): Promise<void>
  sendDocument(chatId: number, doc: OutgoingDocument): Promise<SentMessageRef>
}

// Implemented by ChatOrchestrator, required by TelegramGateway.
export interface IHandleUpdate {
  handleUpdate(update: IncomingUpdate): Promise<void>
}
