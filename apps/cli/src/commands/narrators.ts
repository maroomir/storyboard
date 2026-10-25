import {
  type StoryUri,
  narratorKnowledges,
  narratorPersons,
  narrativeTenses,
  resolveNarration,
  type NarratorCard,
  type NarratorKnowledge,
  type NarratorPerson,
  type NarrativeTense,
  describeNarration,
  type NarrationDirective,
  type StoryboardProject,
  extractErrorMessage,
} from '@storyboard/story-model';

import { flagString } from '@/cliArguments';
import type { CliContainer } from '@/container';

import type { CommandHandler, CommandOutcome } from './outcome';
import type { CreateNarratorCardResult, RemoveNarratorCardResult } from '@storyboard/story-engine';

const narratorIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export const listNarrators: CommandHandler = async ({ container }) => {
  const narrators: NarratorCard[] = [
    ...(await container.cards.listNarrators(container.workspaceRoot)).values(),
  ];

  if (narrators.length === 0) {
    return {
      ok: true,
      message: '서술자 카드가 없습니다. 작품 계약의 시점 하나가 모든 씬에 적용됩니다.',
      data: { narrators: [] },
    };
  }

  const lines: string[] = narrators.map(
    (card) => `${card.id}\t${card.name}\t${describeCard(card)}`,
  );

  return {
    ok: true,
    message: lines.join('\n'),
    data: { narrators: narrators.map(toNarratorData) },
  };
};

export const showNarrator: CommandHandler = async ({ container, args }) => {
  const id: string | undefined = args.positionals[0];

  if (id === undefined) {
    return { ok: false, message: '서술자 id 를 지정해 주세요.' };
  }

  const narrator: NarratorCard | undefined = (
    await container.cards.listNarrators(container.workspaceRoot)
  ).get(id);

  if (!narrator) {
    return { ok: false, message: `서술자 '${id}' 를 찾을 수 없습니다.` };
  }

  return {
    ok: true,
    message: [
      `${narrator.name} (${narrator.id})`,
      describeCard(narrator),
      ...(narrator.voice && narrator.voice.length > 0
        ? [`목소리: ${narrator.voice.join(' / ')}`]
        : []),
    ].join('\n'),
    data: toNarratorData(narrator),
  };
};

export const createNarrator: CommandHandler = async ({ container, args }) => {
  const id: string | undefined = flagString(args.flags, 'id') ?? args.positionals[0];

  if (id === undefined || !narratorIdPattern.test(id)) {
    return {
      ok: false,
      message: '서술자 id 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (예: hana-first).',
    };
  }

  const card: BuildCardResult = buildCard(id, args.flags);

  if (!card.ok) {
    return card.outcome;
  }

  const created: CreateNarratorCardResult = await container.cards.createNarrator(
    container.workspaceRoot,
    card.card,
  );

  if (!created.ok) {
    return { ok: false, message: `이미 있습니다: narrator/${id}.card` };
  }

  return {
    ok: true,
    message: `narrator/${id}.card 를 만들었습니다. 씬 카드의 narrator 에 이 id 를 적으면 그 씬에 적용됩니다.`,
    data: { ...toNarratorData(card.card), path: (created.uri as StoryUri).fsPath },
  };
};

export const removeNarrator: CommandHandler = async ({ container, args }) => {
  const id: string | undefined = args.positionals[0];

  if (id === undefined) {
    return { ok: false, message: '서술자 id 를 지정해 주세요.' };
  }

  const removed: RemoveNarratorCardResult = await container.cards.removeNarrator(
    container.workspaceRoot,
    id,
  );

  if (!removed.ok) {
    return { ok: false, message: `서술자 '${id}' 를 찾을 수 없습니다.` };
  }

  return {
    ok: true,
    message: `narrator/${id}.card 를 지웠습니다. 이 id 를 참조하는 씬이 남아 있으면 doctor 가 알려 줍니다.`,
    data: { id },
  };
};

export async function describeSceneNarration(
  container: Pick<CliContainer, 'workspaceRoot' | 'cards' | 'novel'>,
  sceneNarrator: string | undefined,
  povCharacter: string | undefined,
): Promise<string> {
  const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);

  try {
    const narration: NarrationDirective | undefined = resolveNarration({
      ...(sceneNarrator === undefined ? {} : { sceneNarrator }),
      ...(project.setting?.narration?.defaultNarrator === undefined
        ? {}
        : { defaultNarrator: project.setting.narration.defaultNarrator }),
      ...(project.setting?.pov === undefined ? {} : { pov: project.setting.pov }),
      ...(povCharacter === undefined ? {} : { focalFallback: povCharacter }),
      narrators: await container.cards.listNarrators(container.workspaceRoot),
    });

    return narration ? describeNarration(narration) : '지정 없음';
  } catch (error) {
    return extractErrorMessage(error);
  }
}

type BuildCardResult =
  | { readonly ok: true; readonly card: NarratorCard }
  | { readonly ok: false; readonly outcome: CommandOutcome };

function buildCard(id: string, flags: Readonly<Record<string, string | boolean>>): BuildCardResult {
  const person: string | undefined = flagString(flags, 'person');
  const knowledge: string | undefined = flagString(flags, 'knowledge');
  const tense: string | undefined = flagString(flags, 'tense');
  const focal: string | undefined = flagString(flags, 'focal');
  const name: string | undefined = flagString(flags, 'name');
  const voice: string | undefined = flagString(flags, 'voice');

  if (person !== undefined && !isPerson(person)) {
    return invalid('person', narratorPersons);
  }

  if (knowledge !== undefined && !isKnowledge(knowledge)) {
    return invalid('knowledge', narratorKnowledges);
  }

  if (tense !== undefined && !isTense(tense)) {
    return invalid('tense', narrativeTenses);
  }

  const voiceItems: string[] = (voice ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    ok: true,
    card: {
      type: 'narrator',
      id,
      name: name?.trim() && name.trim().length > 0 ? name.trim() : id,
      person: person ?? 'third',
      knowledge: knowledge ?? 'witnessed',
      ...(tense === undefined ? {} : { tense }),
      ...(focal === undefined ? {} : { focal }),
      ...(voiceItems.length > 0 ? { voice: voiceItems } : {}),
    },
  };
}

function invalid(flagName: string, allowed: readonly string[]): BuildCardResult {
  return {
    ok: false,
    outcome: { ok: false, message: `--${flagName} 는 ${allowed.join(', ')} 중 하나여야 합니다.` },
  };
}

function isPerson(value: string): value is NarratorPerson {
  return (narratorPersons as readonly string[]).includes(value);
}

function isKnowledge(value: string): value is NarratorKnowledge {
  return (narratorKnowledges as readonly string[]).includes(value);
}

function isTense(value: string): value is NarrativeTense {
  return (narrativeTenses as readonly string[]).includes(value);
}

function describeCard(card: NarratorCard): string {
  return describeNarration({
    person: card.person,
    knowledge: card.knowledge,
    ...(card.focal === undefined ? {} : { focal: card.focal }),
    tense: card.tense ?? 'past',
  });
}

function toNarratorData(card: NarratorCard): Record<string, unknown> {
  return {
    id: card.id,
    name: card.name,
    person: card.person,
    knowledge: card.knowledge,
    tense: card.tense ?? 'past',
    focal: card.focal ?? null,
    voice: card.voice ?? [],
  };
}
