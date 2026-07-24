import type { Logger } from '../util/logger';
import type { ChatContext } from './context';
import type { IHandleUpdate, IncomingUpdate, ISendMessage } from './ports';
import { handleJobCallback } from './handlers/generate';
import type { CommandRegistry } from './registry';
import { commandName } from './registry';

export interface UpdateRouterDeps {
  readonly sender: ISendMessage;
  readonly registry: CommandRegistry;
  readonly buildContext: (update: IncomingUpdate) => ChatContext;
  readonly logger: Logger;
}

// Single entry point for authorized updates. A slash command resolves to its handler; anything
// else gets guidance rather than silence.
export class UpdateRouter implements IHandleUpdate {
  public constructor(private readonly deps: UpdateRouterDeps) {}

  public async handleUpdate(update: IncomingUpdate): Promise<void> {
    const ctx = this.deps.buildContext(update);

    try {
      const handler = this.deps.registry.resolve(update);

      if (handler) {
        await handler.execute(ctx);
        return;
      }

      if (update.kind === 'callback') {
        if (await handleJobCallback(ctx, update.data)) {
          return;
        }
        await ctx.answerCallback();
        return;
      }

      const name = commandName(update);
      await ctx.reply({
        text: name
          ? `알 수 없는 명령입니다: ${name}\n/start 로 사용 가능한 명령을 확인하세요.`
          : '명령으로 시작해주세요. /start 로 사용 가능한 명령을 확인할 수 있습니다.',
      });
    } catch (error) {
      // A handler failure must never take the bot down or leave the user without a reply.
      this.deps.logger.error('명령 처리 중 오류가 발생했습니다.', error);
      await ctx
        .reply({ text: '⚠️ 처리 중 오류가 발생했습니다. 로그를 확인해주세요.' })
        .catch(() => undefined);
    }
  }
}
