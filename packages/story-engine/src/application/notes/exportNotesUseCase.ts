import {
  getStoryboardProjectPaths,
  joinStoryPath,
  sceneBeatText,
  serializeSynopsisMarkdown,
  type BackgroundCard,
  type CharacterCard,
  type OutlineSynopsis,
  type SceneFile,
  type StoryUri,
  type StoryboardCard,
} from '@storyboard/story-model';

import type { IStoryFeatureRepository, StoryFeatureSource } from '#engine/application/story/storyFeatureTypes';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';

export interface ExportNotesRequest {
  readonly workspaceRoot: StoryUri;
  // The folder the notes are written into; created when missing, files of the same name replaced.
  readonly target: StoryUri;
}

export interface ExportNotesOutcome {
  readonly ok: true;
  readonly written: readonly string[];
}

export type ExportNotesResult = ExportNotesOutcome | UseCaseFailure;

export interface ExportNotesUseCaseDependencies {
  readonly logger: IStoryboardLogger;
  readonly fileSystem: IFileSystem;
  readonly storyRepository: IStoryFeatureRepository;
  readonly synopsis: { loadSynopsis(workspaceRoot: StoryUri): Promise<OutlineSynopsis | undefined> };
}

// The folders Obsidian will show; the same folder imports into Notion as Markdown.
export const noteExportFolders = {
  characters: '인물',
  backgrounds: '배경',
  scenes: '씬',
  synopsis: '시놉시스.md',
} as const;

// NOTE: 노트 앱으로 나가는 쪽. AI 는 쓰지 않는다. 프런트매터의 `storyboard-id`·`storyboard-type` 과
// 본문의 [[위키링크]]가 카드의 id·관계를 남기므로, 내보낸 폴더를 다시 `notes absorb` 하면 [기존 카드]
// 와 이름으로 이어진다(#54).
export class ExportNotesUseCase implements IUseCase<ExportNotesRequest, ExportNotesResult> {
  public constructor(private readonly deps: ExportNotesUseCaseDependencies) {}

  public async execute(request: ExportNotesRequest): Promise<ExportNotesResult> {
    return await runUseCase(this.deps.logger, '노트를 내보내지 못했습니다.', async () => {
      const source: StoryFeatureSource = await this.deps.storyRepository.load(request.workspaceRoot);
      const synopsis: OutlineSynopsis | undefined = await this.deps.synopsis.loadSynopsis(request.workspaceRoot);
      const nameOf: (id: string) => string = cardNameResolver(source.cards);
      const written: string[] = [];

      const write = async (folder: string | undefined, fileName: string, text: string): Promise<void> => {
        const directory: StoryUri = folder === undefined ? request.target : joinStoryPath(request.target, folder);
        await this.deps.fileSystem.createDirectory(directory);
        await this.deps.fileSystem.writeFile(
          joinStoryPath(directory, fileName),
          new TextEncoder().encode(text),
        );
        written.push(folder === undefined ? fileName : `${folder}/${fileName}`);
      };

      const fileNames: Map<string, string> = uniqueNoteFileNames(source.cards);
      for (const card of source.cards) {
        if (card.type === 'character') {
          await write(noteExportFolders.characters, fileNames.get(card.id) ?? `${card.id}.md`, renderCharacterNote(card, nameOf));
        } else {
          await write(noteExportFolders.backgrounds, fileNames.get(card.id) ?? `${card.id}.md`, renderBackgroundNote(card, nameOf));
        }
      }

      for (const scene of source.scenes) {
        const summary: string | undefined = await this.readSceneSummary(request.workspaceRoot, scene);
        await write(noteExportFolders.scenes, `${scene.stem}.md`, renderSceneNote(scene, nameOf, summary));
      }

      if (synopsis !== undefined) {
        await write(undefined, noteExportFolders.synopsis, renderSynopsisNote(synopsis));
      }

      return { ok: true as const, written };
    });
  }

  // A summary is inline on the card or in the sibling `<stem>.summary.md` the card points at.
  private async readSceneSummary(workspaceRoot: StoryUri, scene: SceneFile): Promise<string | undefined> {
    if (scene.summaryText !== undefined) {
      return scene.summaryText;
    }
    const reference: string | undefined = scene.card.summary;
    if (reference === undefined) {
      return undefined;
    }
    if (!/\.md$/i.test(reference)) {
      return reference;
    }
    const uri: StoryUri = joinStoryPath(getStoryboardProjectPaths(workspaceRoot).sceneDirectory, reference);
    return (await this.deps.fileSystem.exists(uri))
      ? new TextDecoder().decode(await this.deps.fileSystem.readFile(uri))
      : undefined;
  }
}

function cardNameResolver(cards: readonly StoryboardCard[]): (id: string) => string {
  const names: Map<string, string> = new Map(cards.map((card) => [card.id, card.name]));
  return (id) => names.get(id) ?? id;
}

// A note is named after the card; two cards sharing a name get their ids appended so neither is lost.
function uniqueNoteFileNames(cards: readonly StoryboardCard[]): Map<string, string> {
  const counts: Map<string, number> = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  }

  return new Map(
    cards.map((card) => [
      card.id,
      `${safeFileStem((counts.get(card.name) ?? 0) > 1 ? `${card.name} (${card.id})` : card.name)}.md`,
    ]),
  );
}

function safeFileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'untitled';
}

function frontMatter(fields: Readonly<Record<string, string | readonly string[] | undefined>>): string {
  const lines: string[] = Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      return [];
    }
    return typeof value === 'string'
      ? [`${key}: ${yamlScalar(value)}`]
      : [`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`)];
  });

  return ['---', ...lines, '---', ''].join('\n');
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9가-힣_-][^#:\n]*$/.test(value) && !/^\d/.test(value) ? value : JSON.stringify(value);
}

function section(title: string, lines: readonly string[] | undefined): string[] {
  const items: string[] = (lines ?? []).filter((line) => line.trim().length > 0);
  return items.length === 0 ? [] : [`## ${title}`, ...items.map((line) => `- ${line}`), ''];
}

function wikiLink(name: string): string {
  return `[[${name}]]`;
}

export function renderCharacterNote(card: CharacterCard, nameOf: (id: string) => string): string {
  const attributes: string[] = Object.entries(card.attributes ?? {}).map(
    ([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
  );
  const relations: string[] = (card.relations ?? []).map(
    (relation) =>
      `${wikiLink(nameOf(relation.target))}: ${relation.type}${relation.speech === undefined ? '' : ` (말투: ${relation.speech})`}`,
  );

  return [
    frontMatter({
      'storyboard-id': card.id,
      'storyboard-type': 'character',
      role: card.role,
      aliases: card.aliases,
      tags: card.tags,
    }),
    `# ${card.name}`,
    '',
    ...(card.profile === undefined ? [] : [card.profile, '']),
    ...section('소개', card.description),
    ...section('성격', card.traits),
    ...section('말투', card.voice),
    ...section('입버릇', card.catchphrases),
    ...section('바라는 것', card.desire),
    ...section('속성', attributes),
    ...section('관계', relations),
    ...section('아크', (card.arc ?? []).map((arc) => `${arc.stage}: ${arc.summary}`)),
  ].join('\n');
}

export function renderBackgroundNote(card: BackgroundCard, nameOf: (id: string) => string): string {
  return [
    frontMatter({
      'storyboard-id': card.id,
      'storyboard-type': card.type,
      aliases: card.aliases,
      tags: card.tags,
      time: card.time,
      weather: card.weather,
    }),
    `# ${card.name}`,
    '',
    ...section('소개', card.description),
    ...section('감각', card.senses),
    ...section('속한 인물', card.characterIds.map((id) => wikiLink(nameOf(id)))),
  ].join('\n');
}

export function renderSceneNote(
  scene: SceneFile,
  nameOf: (id: string) => string,
  summary: string | undefined,
): string {
  const { card } = scene;
  const beats: string[] = (card.beats ?? []).map((beat) => sceneBeatText(beat));
  const details: string[] = [
    card.purpose === undefined ? undefined : `목적: ${card.purpose}`,
    card.mood === undefined ? undefined : `분위기: ${card.mood}`,
    card.conflict === undefined ? undefined : `갈등: ${card.conflict}`,
    card.endState === undefined ? undefined : `끝 상태: ${card.endState}`,
  ].filter((line): line is string => line !== undefined);

  return [
    frontMatter({
      'storyboard-id': card.id,
      'storyboard-type': 'scene',
      characters: (card.characters ?? []).map((id) => wikiLink(nameOf(id))),
      location: card.location === undefined ? undefined : wikiLink(nameOf(card.location)),
    }),
    `# ${card.title ?? scene.stem}`,
    '',
    ...(summary === undefined ? [] : [summary.trim(), '']),
    ...section('사건', beats),
    ...section('메모', details),
  ].join('\n');
}

export function renderSynopsisNote(synopsis: OutlineSynopsis): string {
  return `${frontMatter({ 'storyboard-type': 'synopsis' })}${serializeSynopsisMarkdown(synopsis)}`;
}
