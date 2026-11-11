import {
  computeBackgroundCardHash,
  computeDraftBodyHash,
  computePersonaCardHash,
  joinStoryPath,
  mainThreadId,
  parseDraft,
  readDraftFile,
  type BackgroundCard,
  type CharacterCard,
  type ElementMemory,
  type SceneDialogueRecord,
  type SceneDialogueTurn,
  type StoryboardProjectPaths,
  type StoryUri,
  type VoiceSampleLine,
  type VoiceSeeds,
} from '@storyboard/story-model';
import { promptResourceFingerprint } from '@storyboard/story-ai';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type {
  SceneRoster,
  SceneRosterEntry,
  WorkspaceScenes,
} from '#engine/persistence/bundles/workspaceScenes';
import type {
  IBackgroundMemoryStore,
  IPersonaMemoryStore,
  ISceneDialogueStore,
} from '#engine/pipeline/memoryStore';

export interface CardMemoryStoreDependencies {
  readonly fileSystem: IFileSystem;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
}

class SceneOrderLookup {
  public constructor(
    private readonly scenes: WorkspaceScenes,
    private readonly workspaceRoot: StoryUri,
  ) {}

  public async idOf(sceneStem: string): Promise<string | undefined> {
    return (await this.scenes.find(this.workspaceRoot, sceneStem))?.content.header.id;
  }

  public async isAheadOf(throughSceneId: string | undefined, sceneStem: string): Promise<boolean> {
    if (throughSceneId === undefined) {
      return false;
    }

    const roster: SceneRoster = await this.scenes.loadRoster(this.workspaceRoot);
    const memoryOrder: number | undefined = roster.entries.find(
      (entry) => entry.content.header.id === throughSceneId,
    )?.file.order;
    const currentOrder: number | undefined = roster.entries.find(
      (entry) => entry.file.stem === sceneStem,
    )?.file.order;

    return memoryOrder !== undefined && currentOrder !== undefined && memoryOrder >= currentOrder;
  }
}

type MemoryCardKind = 'character' | 'background';

class CardMemoryFile {
  private readonly order: SceneOrderLookup;

  public constructor(
    private readonly dependencies: CardMemoryStoreDependencies,
    private readonly paths: StoryboardProjectPaths,
    private readonly sceneStem: string,
  ) {
    this.order = new SceneOrderLookup(dependencies.scenes, paths.workspaceRoot);
  }

  public async loadReusable(
    kind: MemoryCardKind,
    slug: string,
    cardHash: string,
  ): Promise<string | undefined> {
    try {
      const memory: ElementMemory = await this.read(kind, slug);
      const isReusable: boolean =
        memory.cardHash === cardHash &&
        !(await this.order.isAheadOf(memory.throughScene, this.sceneStem));

      return isReusable ? memory.persona : undefined;
    } catch {
      return undefined;
    }
  }

  public async save(kind: MemoryCardKind, slug: string, text: string, cardHash: string): Promise<void> {
    const current: ElementMemory = await this.read(kind, slug);
    const throughScene: string | undefined = await this.order.idOf(this.sceneStem);

    await this.dependencies.cards.writeMemory(this.paths.workspaceRoot, kind, slug, this.paths.threadId, {
      ...current,
      persona: text,
      cardHash,
      ...(throughScene === undefined ? {} : { throughScene }),
    });
  }

  private async read(kind: MemoryCardKind, slug: string): Promise<ElementMemory> {
    return await this.dependencies.cards.readMemory(
      this.paths.workspaceRoot,
      kind,
      slug,
      this.paths.threadId,
    );
  }
}

export class PersonaMemoryStore implements IPersonaMemoryStore {
  private readonly promptFingerprint: string = promptResourceFingerprint('personaGeneration');
  private readonly memory: CardMemoryFile;

  public constructor(
    dependencies: CardMemoryStoreDependencies,
    paths: StoryboardProjectPaths,
    sceneStem: string,
  ) {
    this.memory = new CardMemoryFile(dependencies, paths, sceneStem);
  }

  public async load(card: CharacterCard): Promise<string | undefined> {
    return await this.memory.loadReusable(
      'character',
      card.id,
      computePersonaCardHash(card, this.promptFingerprint),
    );
  }

  public async save(card: CharacterCard, persona: string): Promise<void> {
    await this.memory.save(
      'character',
      card.id,
      persona,
      computePersonaCardHash(card, this.promptFingerprint),
    );
  }
}

export class BackgroundMemoryStore implements IBackgroundMemoryStore {
  private readonly memory: CardMemoryFile;

  public constructor(
    dependencies: CardMemoryStoreDependencies,
    paths: StoryboardProjectPaths,
    sceneStem: string,
  ) {
    this.memory = new CardMemoryFile(dependencies, paths, sceneStem);
  }

  public async load(card: BackgroundCard): Promise<string | undefined> {
    return await this.memory.loadReusable('background', card.id, computeBackgroundCardHash(card));
  }

  public async save(card: BackgroundCard, atmosphere: string): Promise<void> {
    await this.memory.save('background', card.id, atmosphere, computeBackgroundCardHash(card));
  }
}

function threadOf(entry: SceneRosterEntry): string {
  return entry.entry?.thread ?? mainThreadId;
}

export class SceneDialogueStore implements ISceneDialogueStore {
  public constructor(
    private readonly dependencies: CardMemoryStoreDependencies,
    private readonly paths: StoryboardProjectPaths,
  ) {}

  public async save(record: SceneDialogueRecord): Promise<void> {
    await this.dependencies.scenes.writeDialogue(this.paths.workspaceRoot, record.sceneStem, record);
  }

  public async loadCorpus(): Promise<readonly SceneDialogueRecord[]> {
    const roster: SceneRoster = await this.dependencies.scenes.loadRoster(this.paths.workspaceRoot);
    const corpus: SceneDialogueRecord[] = [];

    for (const entry of roster.entries.filter((item) => threadOf(item) === this.paths.threadId)) {
      const record: SceneDialogueRecord | undefined = await this.dependencies.scenes.readDialogue(
        this.paths.workspaceRoot,
        entry.file.stem,
      );
      const reconciled: SceneDialogueRecord | undefined =
        record === undefined
          ? undefined
          : await this.reconcileWithDraft({ ...record, sceneStem: entry.file.stem });
      if (reconciled !== undefined) {
        corpus.push(reconciled);
      }
    }

    return corpus;
  }

  public async loadVoiceSeeds(): Promise<VoiceSeeds> {
    const cards: CardRoster = await this.dependencies.cards.loadRoster(this.paths.workspaceRoot);
    const characters: Record<string, string[]> = {};

    for (const card of cards.characters) {
      const samples: readonly VoiceSampleLine[] =
        (
          await this.dependencies.cards.readMemory(
            this.paths.workspaceRoot,
            'character',
            card.id,
            mainThreadId,
          )
        ).voiceSample ?? [];
      if (samples.length > 0) {
        characters[card.id] = samples.map((sample) => sample.text);
      }
    }

    return { characters };
  }

  private async reconcileWithDraft(
    record: SceneDialogueRecord,
  ): Promise<SceneDialogueRecord | undefined> {
    const draftUri: StoryUri = joinStoryPath(this.paths.draftDirectory, `${record.sceneStem}.md`);

    let body: string;
    try {
      body = parseDraft(await readDraftFile(draftUri, this.dependencies.fileSystem)).body;
    } catch {
      return undefined;
    }

    if (computeDraftBodyHash(body) === record.bodyHash) {
      return record;
    }

    const surviving: SceneDialogueTurn[] = record.turns.filter((turn) => body.includes(turn.text));
    return surviving.length > 0 ? { ...record, turns: surviving } : undefined;
  }
}
