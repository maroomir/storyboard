import { Bot, GrammyError, InputFile } from 'grammy';

import { splitText, TELEGRAM_MAX_MESSAGE_LENGTH } from '../chat/messageSplit';
import type {
  BotCommand,
  IHandleUpdate,
  IncomingUpdate,
  InlineKeyboard,
  ISendMessage,
  MessageView,
  OutgoingDocument,
  SentMessageRef,
} from '../chat/ports';
import type { Logger } from '../util/logger';
import type { IAllowlist } from './allowlist';

const MAX_RETRY_ATTEMPTS = 3;
const TELEGRAM_COMMAND_MAX_DESCRIPTION = 256;

// QA-04: authorization gate. Unauthorized updates are dropped silently (no reply reveals the
// bot's existence) and only audited. Extracted from the grammy wiring so it is unit-testable.
export async function dispatchUpdate(
  update: IncomingUpdate,
  allowlist: IAllowlist,
  handler: IHandleUpdate,
  logger: Logger,
): Promise<void> {
  if (!allowlist.isAllowed(update.chatId, update.userId)) {
    logger.warn(`allowlist 차단: chat=${update.chatId} user=${update.userId ?? '?'}`);
    return;
  }

  await handler.handleUpdate(update);
}

export interface TelegramGatewayOptions {
  readonly botToken: string;
  readonly allowlist: IAllowlist;
  readonly logger: Logger;
}

export class TelegramGateway implements ISendMessage {
  private readonly bot: Bot;
  // SECURITY: the bot token authenticates every file download URL; never log it or the URL built
  // from it. Held privately so no other layer can reach it.
  private readonly allowlist: IAllowlist;
  private readonly logger: Logger;
  private handler: IHandleUpdate | undefined;

  public constructor(options: TelegramGatewayOptions) {
    this.bot = new Bot(options.botToken);
    this.allowlist = options.allowlist;
    this.logger = options.logger;
  }

  // Begins long polling (AC-04: outbound only, no inbound listener). grammy owns offset tracking
  // and network-error backoff. Returns once polling has started; the poll loop runs in background.
  public async start(handler: IHandleUpdate): Promise<void> {
    this.handler = handler;
    this.registerListeners();

    // Verifies the token against getMe before polling: a misconfigured token must fail boot
    // loudly instead of leaving a bot that "started" but can never receive an update.
    await this.bot.init();

    this.bot
      .start({ onStart: (info) => this.logger.info(`long polling 시작: @${info.username}`) })
      .catch((error) => this.logger.error('폴링 루프가 종료되었습니다.', error));
  }

  public async stop(): Promise<void> {
    await this.bot.stop();
  }

  public async sendMessage(chatId: number, view: MessageView): Promise<SentMessageRef> {
    const chunks = splitText(view.text);
    let lastMessageId = 0;

    for (const [index, chunk] of chunks.entries()) {
      const isLastChunk = index === chunks.length - 1;
      const replyMarkup = isLastChunk ? toReplyMarkup(view.keyboard) : undefined;
      const sent = await this.call(() =>
        this.bot.api.sendMessage(chatId, chunk, replyMarkup ? { reply_markup: replyMarkup } : {}),
      );
      lastMessageId = sent.message_id;
    }

    return { chatId, messageId: lastMessageId };
  }

  public async editMessage(ref: SentMessageRef, view: MessageView): Promise<SentMessageRef> {
    // A single message cannot be edited into several; if it grew past the limit, fall back to a
    // fresh (split) message rather than truncating content.
    if (view.text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      return this.sendMessage(ref.chatId, view);
    }

    // An omitted reply_markup would leave the prior keyboard in place, so an empty keyboard is sent
    // explicitly to drop it (lets callers retire buttons after a one-shot action).
    const replyMarkup = toReplyMarkup(view.keyboard) ?? { inline_keyboard: [] };
    await this.call(() =>
      this.bot.api.editMessageText(ref.chatId, ref.messageId, view.text, {
        reply_markup: replyMarkup,
      }),
    );
    return ref;
  }

  public async sendDocument(chatId: number, doc: OutgoingDocument): Promise<SentMessageRef> {
    const sent = await this.call(() =>
      this.bot.api.sendDocument(
        chatId,
        new InputFile(doc.bytes, doc.fileName),
        doc.caption ? { caption: doc.caption } : {},
      ),
    );
    return { chatId, messageId: sent.message_id };
  }

  public async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    await this.call(() => this.bot.api.answerCallbackQuery(callbackQueryId, text ? { text } : {}));
  }

  // Registers the native command menu so Telegram shows autocomplete + a menu button. Sanitizes to
  // Telegram's constraints (name without slash, `[a-z0-9_]{1,32}`); silently skips entries that do
  // not qualify rather than letting one bad command reject the whole call.
  public async setCommandMenu(commands: readonly BotCommand[]): Promise<void> {
    const menu = toBotCommandMenu(commands);
    if (menu.length === 0) {
      return;
    }

    await this.call(() => this.bot.api.setMyCommands(menu.map((entry) => ({ ...entry }))));
  }

  private registerListeners(): void {
    this.bot.on('message:text', (ctx) =>
      this.safeDispatch({
        kind: 'message',
        chatId: ctx.chat.id,
        userId: ctx.from?.id,
        messageId: ctx.message.message_id,
        text: ctx.message.text,
      }),
    );

    this.bot.on('callback_query:data', (ctx) =>
      this.safeDispatch({
        kind: 'callback',
        chatId: ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id ?? 0,
        userId: ctx.from?.id,
        messageId: ctx.callbackQuery.message?.message_id ?? 0,
        callbackQueryId: ctx.callbackQuery.id,
        data: ctx.callbackQuery.data,
      }),
    );
  }

  // A handler failure must not tear down the poll loop (QA-02: isolate per-update errors).
  private async safeDispatch(update: IncomingUpdate): Promise<void> {
    if (!this.handler) {
      return;
    }

    try {
      await dispatchUpdate(update, this.allowlist, this.handler, this.logger);
    } catch (error) {
      this.logger.error(`업데이트 처리 실패: chat=${update.chatId}`, error);
    }
  }

  // AC-06: honor Telegram 429 retry_after with bounded retries.
  private async call<T>(action: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof GrammyError &&
        error.error_code === 429 &&
        attempt < MAX_RETRY_ATTEMPTS
      ) {
        const retryAfterSec = error.parameters.retry_after ?? 1;
        this.logger.warn(`Telegram rate limit(429), ${retryAfterSec}s 후 재시도`);
        await delay(retryAfterSec * 1000);
        return this.call(action, attempt + 1);
      }

      throw error;
    }
  }
}

// Maps command handlers (`/help`, "명령 목록 보기") to Telegram menu entries, dropping the leading
// slash and any name that violates Telegram's `[a-z0-9_]{1,32}` rule (e.g. multi-word aliases).
export function toBotCommandMenu(commands: readonly BotCommand[]): BotCommand[] {
  const seen = new Set<string>();
  const menu: BotCommand[] = [];

  for (const entry of commands) {
    const command = entry.command.replace(/^\//, '').toLowerCase();
    const description = entry.description.trim().slice(0, TELEGRAM_COMMAND_MAX_DESCRIPTION);

    if (!/^[a-z0-9_]{1,32}$/.test(command) || description.length === 0 || seen.has(command)) {
      continue;
    }

    seen.add(command);
    menu.push({ command, description });
  }

  return menu;
}

function toReplyMarkup(keyboard: InlineKeyboard | undefined) {
  if (!keyboard || keyboard.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
    ),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
