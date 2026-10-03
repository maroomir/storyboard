import {
  getStoryboardProjectPaths,
  loadNarratorCards,
  readProjectJson,
} from '@storyboard/story-engine';
import {
  joinStoryPath,
  type StoryUri,
  narratorKnowledges,
  narratorPersons,
  narrativeTenses,
  resolveNarration,
  serializeNarratorCard,
  type NarratorCard,
  type NarratorKnowledge,
  type NarratorPerson,
  type NarrativeTense,
  describeNarration,
} from '@storyboard/story-model';

import { flagString } from '@/cliArguments';

import type { CommandHandler, CommandOutcome } from './outcome';

const narratorIdPattern = /^[a-z0-9][a-z0-9-]*$/;

function narratorCardPath(workspaceRoot: StoryUri, id: string): StoryUri {
  return joinStoryPath(getStoryboardProjectPaths(workspaceRoot).narratorDirectory, `${id}.card`);
}

export const listNarrators: CommandHandler = async ({ container }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const narrators = [...(await loadNarratorCards(paths, container.fileSystem)).values()];

  if (narrators.length === 0) {
    return {
      ok: true,
      message: '서술자 카드가 없습니다. 작품 계약의 시점 하나가 모든 씬에 적용됩니다.',
      data: { narrators: [] },
    };
  }

  const lines = narrators.map((card) => `${card.id}\t${card.name}\t${describeCard(card)}`);

  return {
    ok: true,
    message: lines.join('\n'),
    data: { narrators: narrators.map(toNarratorData) },
  };
};

export const showNarrator: CommandHandler = async ({ container, args }) => {
  const id = args.positionals[0];

  if (id === undefined) {
    return { ok: false, message: '서술자 id 를 지정해 주세요.' };
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const narrator = (await loadNarratorCards(paths, container.fileSystem)).get(id);

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

export const addNarrator: CommandHandler = async ({ container, args }) => {
  const id = flagString(args.flags, 'id') ?? args.positionals[0];

  if (id === undefined || !narratorIdPattern.test(id)) {
    return {
      ok: false,
      message: '서술자 id 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (예: hana-first).',
    };
  }

  const card = buildCard(id, args.flags);

  if (!card.ok) {
    return card.outcome;
  }

  const uri = narratorCardPath(container.workspaceRoot, id);

  if (await container.fileSystem.exists(uri)) {
    return { ok: false, message: `이미 있습니다: narrator/${id}.card` };
  }

  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  await container.fileSystem.createDirectory(paths.narratorDirectory);
  await container.fileSystem.writeFile(
    uri,
    new TextEncoder().encode(serializeNarratorCard(card.card)),
  );

  return {
    ok: true,
    message: `narrator/${id}.card 를 만들었습니다. 씬 카드의 narrator 에 이 id 를 적으면 그 씬에 적용됩니다.`,
    data: { ...toNarratorData(card.card), path: uri.fsPath },
  };
};

export const removeNarrator: CommandHandler = async ({ container, args }) => {
  const id = args.positionals[0];

  if (id === undefined) {
    return { ok: false, message: '서술자 id 를 지정해 주세요.' };
  }

  const uri = narratorCardPath(container.workspaceRoot, id);

  if (!(await container.fileSystem.exists(uri))) {
    return { ok: false, message: `서술자 '${id}' 를 찾을 수 없습니다.` };
  }

  await container.fileSystem.delete(uri);

  return {
    ok: true,
    // 참조가 남아 있으면 생성이 그 씬에서 멈춘다. 지우는 자리에서 알려 두는 편이 낫다.
    message: `narrator/${id}.card 를 지웠습니다. 이 id 를 참조하는 씬이 남아 있으면 doctor 가 알려 줍니다.`,
    data: { id },
  };
};

// 씬이 어떤 시점으로 생성될지 해석된 결과 한 줄. 파생이 어떻게 됐는지 눈으로 확인하는 자리다.
export async function describeSceneNarration(
  container: { readonly workspaceRoot: StoryUri; readonly fileSystem: FileSystemLike },
  sceneNarrator: string | undefined,
  povCharacter: string | undefined,
): Promise<string> {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const project = await readProjectJson(container.fileSystem, paths.projectJson);

  try {
    const narration = resolveNarration({
      ...(sceneNarrator === undefined ? {} : { sceneNarrator }),
      ...(project.setting?.narration?.defaultNarrator === undefined
        ? {}
        : { defaultNarrator: project.setting.narration.defaultNarrator }),
      ...(project.setting?.pov === undefined ? {} : { pov: project.setting.pov }),
      ...(povCharacter === undefined ? {} : { focalFallback: povCharacter }),
      narrators: await loadNarratorCards(paths, container.fileSystem),
    });

    return narration ? describeNarration(narration) : '지정 없음';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type FileSystemLike = Parameters<typeof loadNarratorCards>[1];

type BuildCardResult =
  | { readonly ok: true; readonly card: NarratorCard }
  | { readonly ok: false; readonly outcome: CommandOutcome };

function buildCard(id: string, flags: Readonly<Record<string, string | boolean>>): BuildCardResult {
  const person = flagString(flags, 'person');
  const knowledge = flagString(flags, 'knowledge');
  const tense = flagString(flags, 'tense');
  const focal = flagString(flags, 'focal');
  const name = flagString(flags, 'name');
  const voice = flagString(flags, 'voice');

  if (person !== undefined && !isPerson(person)) {
    return invalid('person', narratorPersons);
  }

  if (knowledge !== undefined && !isKnowledge(knowledge)) {
    return invalid('knowledge', narratorKnowledges);
  }

  if (tense !== undefined && !isTense(tense)) {
    return invalid('tense', narrativeTenses);
  }

  const voiceItems = (voice ?? '')
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
