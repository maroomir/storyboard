import {
  compositionKindLabels,
  contractFieldLabels,
  pointOfViewLabels,
  serializeCard,
  validateGenerationContract,
  type SceneListItem,
  type StoryUri,
} from '@storyboard/story-model';

import { cardCategories, type CardCategory } from './catalog';
import type { CommandHandler } from './outcome';

const draftStatusLabels: Readonly<Record<SceneListItem['status'], string>> = {
  missing: '초안 없음',
  ready: '초안 있음',
  stale: '초안이 카드보다 오래됨',
};

const cardCategoryLabels: Readonly<Record<CardCategory, string>> = {
  character: '인물',
  background: '배경',
};

export const listScenes: CommandHandler = async ({ container }) => {
  const scenes = await container.drafts.listScenes(container.workspaceRoot);

  if (scenes.length === 0) {
    return { ok: true, message: '씬 카드가 없습니다.', data: { scenes: [] } };
  }

  return {
    ok: true,
    message: scenes
      .map((scene) => `${scene.stem}\t${scene.title ?? ''}\t${draftStatusLabels[scene.status]}`)
      .join('\n'),
    data: {
      scenes: scenes.map((scene) => ({
        stem: scene.stem,
        order: scene.order,
        title: scene.title ?? null,
        draft: scene.status,
      })),
    },
  };
};

export const listCards: CommandHandler = async ({ container, args }) => {
  const requested = args.positionals[0];
  const categories = cardCategories.filter(
    (category) => requested === undefined || category === requested,
  );

  if (categories.length === 0) {
    return {
      ok: false,
      message: `카드 종류를 알 수 없습니다: ${requested}\n쓸 수 있는 값: ${cardCategories.join(', ')}`,
    };
  }

  const cards = (
    await Promise.all(
      categories.map(async (category) =>
        (await container.cards.list(container.workspaceRoot, category)).map((summary) => ({
          category,
          // NOTE: 읽지 못한 카드는 id 자리에 경로가 온다. 파일 이름이 곧 id 다.
          id: summary.error === undefined ? summary.id : summary.name.replace(/\.card$/, ''),
          name: summary.error === undefined ? summary.name : null,
          role: summary.role ?? null,
          error: summary.error ?? null,
        })),
      ),
    )
  ).flat();

  if (cards.length === 0) {
    return { ok: true, message: '카드가 없습니다.', data: { cards: [] } };
  }

  return {
    ok: true,
    message: cards
      .map(
        (card) =>
          `${card.id}\t${card.name ?? `읽을 수 없음: ${card.error}`}\t${cardCategoryLabels[card.category]}`,
      )
      .join('\n'),
    data: { cards },
  };
};

export const showCard: CommandHandler = async ({ container, args }) => {
  const id = args.positionals[0];

  if (id === undefined) {
    return { ok: false, message: '카드 id 를 지정해 주세요: storyboard card show <id>' };
  }

  const reading = await container.cards.read(container.workspaceRoot, id);

  if (reading === undefined) {
    return { ok: false, message: `카드를 찾을 수 없습니다: ${id}` };
  }

  return {
    ok: true,
    message: [
      `${reading.card.name} (${reading.card.id}) — ${cardCategoryLabels[reading.category]}`,
      '',
      serializeCard(reading.card).trimEnd(),
    ].join('\n'),
    data: {
      category: reading.category,
      id: reading.card.id,
      path: (reading.uri as StoryUri).fsPath,
      card: reading.card,
    },
  };
};

// 본문만 stdout 으로 낸다 — 다른 도구로 바로 넘길 수 있게. 경로와 생성 정보는 --json 에 있다.
export const showDraft: CommandHandler = async ({ container, args }) => {
  const stem = args.positionals[0]?.replace(/\.card$/, '');

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요: storyboard draft show <stem>' };
  }

  const reading = await container.drafts.readDraft(container.workspaceRoot, stem);

  if (reading === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const { draft } = reading;

  return {
    ok: true,
    message: draft.body.trimEnd(),
    data: {
      stem,
      path: (reading.uri as StoryUri).fsPath,
      characterCount: draft.body.length,
      generatedAt: draft.generatedAt,
      providerId: draft.providerId ?? null,
      model: draft.model ?? null,
      warnings: draft.warnings ?? [],
      body: draft.body,
    },
  };
};

export const showProject: CommandHandler = async ({ container }) => {
  const project = await container.novel.readProject(container.workspaceRoot);
  const setting = project.setting;
  const { missing } = validateGenerationContract(setting);
  const rows: readonly (readonly [string, string | number | undefined])[] = [
    [contractFieldLabels.genre, setting?.genre],
    [contractFieldLabels.audience, setting?.audience],
    [contractFieldLabels.pov, setting?.pov && `${setting.pov} (${pointOfViewLabels[setting.pov]})`],
    [contractFieldLabels.targetWordCount, setting?.targetWordCount],
    [
      '구성',
      setting?.composition &&
        `${setting.composition} (${compositionKindLabels[setting.composition]})`,
    ],
    ['장 수', setting?.chapterCount],
    ['장당 씬 수', setting?.scenesPerChapter],
    ['콘셉트', setting?.concept],
    ['설명', setting?.description],
  ];

  return {
    ok: true,
    message: [
      `${project.name} (${project.format}, ${project.language})`,
      ...rows.map(([label, value]) => `${label}: ${value ?? '—'}`),
      ...(missing.length === 0
        ? []
        : [
            '',
            `비어 있어 생성할 수 없는 항목: ${missing.map((key) => contractFieldLabels[key]).join(', ')} (storyboard project set)`,
          ]),
    ].join('\n'),
    data: {
      id: project.id,
      name: project.name,
      format: project.format,
      language: project.language,
      setting: setting ?? null,
      missing,
    },
  };
};
