import { CardEditError, cardListFields, isCardListField } from '../../content/cardEditor';
import type { MutateOutcome } from '../../workspace/workspaceChanges';
import { describeStale } from '../../workspace/workspaceChanges';
import type { ChatContext } from '../context';
import type { IncomingUpdate } from '../ports';
import { commandArgs, isCommand, type ICommandHandler } from '../registry';

const USAGE = [
  '사용법:',
  '  /rename <카드 id> <새 이름>',
  `  /set <카드 id> <항목> <값1> | <값2> …   (항목: ${cardListFields.join(', ')})`,
].join('\n');

export function createRenameHandler(): ICommandHandler {
  return {
    command: '/rename',
    description: '카드 이름 변경 (/rename <id> <새 이름>)',
    match: (update: IncomingUpdate) => isCommand(update, '/rename'),
    execute: async (ctx) => {
      const [id, ...rest] = commandArgs(ctx.update).split(/\s+/);
      const name = rest.join(' ').trim();

      if (!id || name.length === 0) {
        await ctx.reply({ text: USAGE });
        return;
      }

      await runEdit(ctx, id, async (kind) => ctx.content.renameCard(kind, id, name));
    },
  };
}

export function createSetHandler(): ICommandHandler {
  return {
    command: '/set',
    description: '카드 목록 항목 수정 (/set <id> <항목> <값1> | <값2>)',
    match: (update: IncomingUpdate) => isCommand(update, '/set'),
    execute: async (ctx) => {
      const [id, field, ...rest] = commandArgs(ctx.update).split(/\s+/);
      const raw = rest.join(' ').trim();

      if (!id || !field || raw.length === 0) {
        await ctx.reply({ text: USAGE });
        return;
      }

      if (!isCardListField(field)) {
        await ctx.reply({ text: `알 수 없는 항목입니다: ${field}\n\n${USAGE}` });
        return;
      }

      const values = raw.split('|').map((value) => value.trim());
      await runEdit(ctx, id, async (kind) => ctx.content.updateCardList(kind, id, field, values));
    },
  };
}

async function runEdit(
  ctx: ChatContext,
  id: string,
  edit: (kind: 'character' | 'background') => Promise<MutateOutcome>,
): Promise<void> {
  const summary = (await ctx.content.listCards()).find((card) => card.id === id);
  if (!summary) {
    await ctx.reply({ text: `카드를 찾을 수 없습니다: ${id}` });
    return;
  }

  let outcome: MutateOutcome;
  try {
    outcome = await edit(summary.kind);
  } catch (error) {
    if (error instanceof CardEditError) {
      await ctx.reply({ text: `⚠️ ${error.message}` });
      return;
    }
    throw error;
  }

  await ctx.reply({ text: describeOutcome(outcome) });
}

function describeOutcome(outcome: MutateOutcome): string {
  switch (outcome.status) {
    case 'committed':
      return `✅ 저장하고 커밋했습니다: ${outcome.paths.join(', ')}`;
    case 'written':
      return `✅ 저장했습니다: ${outcome.paths.join(', ')}`;
    case 'no-op':
      return '변경된 내용이 없습니다.';
    case 'stale':
      return describeStale(outcome.files);
    case 'blocked':
      return `⚠️ 지금은 저장할 수 없습니다. ${outcome.detail}`;
  }
}
