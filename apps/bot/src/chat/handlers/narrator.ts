import { describeNarration } from '@storyboard/story-ai';
import {
  narratorKnowledges,
  narratorPersons,
  resolveNarration,
  type NarratorCard,
  type NarratorKnowledge,
  type NarratorPerson,
} from '@storyboard/story-format';

import type { ChatContext } from '@/chat/context';
import type { IncomingUpdate } from '@/chat/ports';
import { commandArgs, isCommand, type ICommandHandler } from '@/chat/registry';
import { describeOutcome } from './edit';

const USAGE = [
  '사용법:',
  '/narrator — 서술자 목록',
  '/narrator add <id> <인칭> <지식 경계> [초점 인물]',
  '',
  `인칭: ${narratorPersons.join(' · ')}`,
  `지식 경계: ${narratorKnowledges.join(' · ')}`,
  '',
  '예: /narrator add hana-first first witnessed hana',
  '만든 뒤 씬 카드의 narrator 에 그 id 를 적으면 그 씬만 이 시점으로 생성됩니다.',
].join('\n');

const narratorIdPattern = /^[a-z0-9][a-z0-9-]*$/;

export function createNarratorHandler(): ICommandHandler {
  return {
    command: '/narrator',
    description: '서술자 카드 조회·생성 (/narrator · add)',
    match: (update: IncomingUpdate) => isCommand(update, '/narrator'),
    execute: async (ctx) => {
      const tokens = commandArgs(ctx.update)
        .split(/\s+/)
        .filter((token) => token.length > 0);

      if (tokens.length === 0) {
        await listNarrators(ctx);
        return;
      }

      if (tokens[0] !== 'add') {
        await ctx.reply({ text: USAGE });
        return;
      }

      await addNarrator(ctx, tokens.slice(1));
    },
  };
}

async function listNarrators(ctx: ChatContext): Promise<void> {
  const narrators = await ctx.content.listNarrators();
  const project = await ctx.store.readProject();
  const projectNarration = resolveNarration({
    ...(project.value.setting?.pov === undefined ? {} : { pov: project.value.setting.pov }),
  });

  const projectLine = `작품 기본 시점: ${projectNarration ? describeNarration(projectNarration) : '지정 없음'}`;

  if (narrators.length === 0) {
    await ctx.reply({
      text: [projectLine, '', '서술자 카드가 없어 모든 씬이 이 시점으로 생성됩니다.', '', USAGE].join(
        '\n',
      ),
    });
    return;
  }

  await ctx.reply({
    text: [
      `🗣 서술자 (${narrators.length})`,
      projectLine,
      '',
      ...narrators.map((card) => `  ${card.id} — ${card.name} · ${describeCard(card)}`),
    ].join('\n'),
  });
}

async function addNarrator(ctx: ChatContext, tokens: readonly string[]): Promise<void> {
  const [id, person, knowledge, focal, ...rest] = tokens;

  if (id === undefined || rest.length > 0) {
    await ctx.reply({ text: USAGE });
    return;
  }

  if (!narratorIdPattern.test(id)) {
    await ctx.reply({ text: '서술자 id 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (예: hana-first).' });
    return;
  }

  if (person !== undefined && !isPerson(person)) {
    await ctx.reply({ text: `인칭은 ${narratorPersons.join(', ')} 중 하나여야 합니다.` });
    return;
  }

  if (knowledge !== undefined && !isKnowledge(knowledge)) {
    await ctx.reply({ text: `지식 경계는 ${narratorKnowledges.join(', ')} 중 하나여야 합니다.` });
    return;
  }

  if ((await ctx.content.listNarrators()).some((card) => card.id === id)) {
    await ctx.reply({ text: `이미 있습니다: narrator/${id}.card` });
    return;
  }

  const card: NarratorCard = {
    type: 'narrator',
    id,
    name: id,
    person: person ?? 'third',
    knowledge: knowledge ?? 'witnessed',
    ...(focal === undefined ? {} : { focal }),
  };

  const outcome = await ctx.content.createNarrator(card);

  await ctx.reply({
    text:
      outcome.status === 'committed'
        ? [
            `🗣 narrator/${id}.card 를 만들었습니다 — ${describeCard(card)}`,
            '씬 카드의 narrator 에 이 id 를 적으면 그 씬만 이 시점으로 생성됩니다.',
          ].join('\n')
        : describeOutcome(outcome),
  });
}

function describeCard(card: NarratorCard): string {
  return describeNarration({
    person: card.person,
    knowledge: card.knowledge,
    ...(card.focal === undefined ? {} : { focal: card.focal }),
    tense: card.tense ?? 'past',
  });
}

function isPerson(value: string): value is NarratorPerson {
  return (narratorPersons as readonly string[]).includes(value);
}

function isKnowledge(value: string): value is NarratorKnowledge {
  return (narratorKnowledges as readonly string[]).includes(value);
}
