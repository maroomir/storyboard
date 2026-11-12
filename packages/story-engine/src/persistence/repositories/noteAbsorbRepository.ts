import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import {
  parseSceneFileName,
  serializeSynopsisMarkdown,
  type OutlineSynopsis,
  type SceneCard,
  type StoryUri,
  type StoryboardCard,
  type StoryboardProject,
  getStoryboardProjectPaths,
  mainThreadId,
  replacePendingHeader,
  replacePendingStatements,
  describeNoteSource,
  type NoteBundle,
  type NoteSourceKind,
  type NoteVoiceSeed,
  type NoteExtractionResponse,
  type Statement,
  type PendingHeaderChange,
} from '@storyboard/story-model';

import type {
  INoteAbsorbRepository,
  NoteSynopsisCandidate,
} from '#engine/application/notes/noteAbsorbRepository';
import { SessionStore, type SessionRecord } from '#engine/persistence/cache/sessionStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type {
  BibleSubjectKind,
  NoteAbsorbPlan,
  StatementSource,
  ElementMemory,
  VoiceSampleLine,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

const absorbedSource: StatementSource = { origin: 'studio' };
import { createHash } from 'node:crypto';

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

interface AbsorbSessionData {
  readonly location?: string;
  readonly bundle?: NoteBundle;
  readonly plan?: NoteAbsorbPlan;
  readonly responses?: readonly NoteExtractionResponse[];
  readonly synopsisCandidate?: string;
}

function locationKeyOf(location: string): string {
  return createHash('sha256').update(location).digest('hex').slice(0, 16);
}

function absorbSessionId(location: string): string {
  return `absorb:${locationKeyOf(location)}`;
}

function absorbDataOf(record: SessionRecord | undefined): AbsorbSessionData {
  const data: unknown = record?.data;
  return typeof data === 'object' && data !== null ? (data as AbsorbSessionData) : {};
}

function isOfLocation(record: SessionRecord, location: string | undefined): boolean {
  return location === undefined || absorbDataOf(record).location === location;
}

export class NoteAbsorbRepository implements INoteAbsorbRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly cards: WorkspaceCards,
    private readonly scenes: WorkspaceScenes,
    private readonly caches: WorkspaceCaches,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public async saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void> {
    await this.updateAbsorbSession(workspaceRoot, bundle.location, (data) => ({ ...data, bundle }));
  }

  public async savePlan(workspaceRoot: StoryUri, location: string, plan: NoteAbsorbPlan): Promise<void> {
    await this.updateAbsorbSession(workspaceRoot, location, (data) => ({ ...data, plan }));
  }

  public async saveExtractionResponses(
    workspaceRoot: StoryUri,
    location: string,
    responses: readonly NoteExtractionResponse[],
  ): Promise<void> {
    await this.updateAbsorbSession(workspaceRoot, location, (data) => ({ ...data, responses }));
  }

  public async saveCardPending(
    workspaceRoot: StoryUri,
    location: string,
    cardId: string,
    statements: readonly Statement[],
    header?: PendingHeaderChange,
  ): Promise<void> {
    const elementId: string | undefined = (await this.cards.findBundleBySlug(workspaceRoot, cardId))
      ?.header.id;
    if (elementId === undefined) {
      throw new Error(`제안을 남길 카드가 없습니다: ${cardId}`);
    }

    const store: SessionStore = await this.store(workspaceRoot);
    const id: string = `${absorbSessionId(location)}:${elementId}`;
    store.save({
      id,
      kind: 'absorb',
      elementId,
      openedAt: store.find(id)?.openedAt ?? this.now().toISOString(),
      data: replacePendingHeader(replacePendingStatements({ location }, statements), header),
      pendingCount: statements.length + (header === undefined ? 0 : 1),
    });
  }

  public async clearCardPending(workspaceRoot: StoryUri, location?: string): Promise<void> {
    const store: SessionStore = await this.store(workspaceRoot);

    for (const record of store.listByKind('absorb')) {
      if (record.elementId !== undefined && isOfLocation(record, location)) {
        store.update(record.id, {
          data: replacePendingHeader(replacePendingStatements(record.data, []), undefined),
          pendingCount: 0,
        });
      }
    }
  }

  public async listCardsWithPending(workspaceRoot: StoryUri): Promise<readonly string[]> {
    const pendingIds: ReadonlySet<string> = new Set(
      (await this.store(workspaceRoot))
        .listByKind('absorb')
        .filter((record) => record.elementId !== undefined && record.pendingCount > 0)
        .flatMap((record) => (record.elementId === undefined ? [] : [record.elementId])),
    );
    const lookup: CardRoster['lookup'] = (await this.cards.loadRoster(workspaceRoot)).lookup;

    return [...pendingIds].flatMap((id) => {
      const slug: string | undefined = lookup.slugOf(id);
      return slug === undefined ? [] : [slug];
    });
  }

  public async loadCard(
    workspaceRoot: StoryUri,
    cardType: BibleSubjectKind,
    id: string,
  ): Promise<StoryboardCard | undefined> {
    const card: StoryboardCard | undefined = await this.cards.findCard(workspaceRoot, id);
    const isRequestedKind: boolean =
      card !== undefined && (card.type === 'character') === (cardType === 'character');

    return isRequestedKind ? card : undefined;
  }

  public async sceneExists(workspaceRoot: StoryUri, fileName: string): Promise<boolean> {
    const slug: string | undefined = parseSceneFileName(fileName)?.slug;
    return slug !== undefined && (await this.scenes.find(workspaceRoot, slug)) !== undefined;
  }

  public async writeScene(
    workspaceRoot: StoryUri,
    fileName: string,
    card: SceneCard,
  ): Promise<void> {
    const slug: string | undefined = parseSceneFileName(fileName)?.slug;
    await this.scenes.writeCard(workspaceRoot, card, {
      source: absorbedSource,
      ...(slug === undefined ? {} : { slug }),
    });
  }

  public async synopsisExists(workspaceRoot: StoryUri): Promise<boolean> {
    return await this.fileSystem.exists(getStoryboardProjectPaths(workspaceRoot).outlineSynopsis);
  }

  public async writeSynopsis(workspaceRoot: StoryUri, synopsis: OutlineSynopsis): Promise<void> {
    await this.fileSystem.writeFile(
      getStoryboardProjectPaths(workspaceRoot).outlineSynopsis,
      encodeText(serializeSynopsisMarkdown(synopsis)),
    );
  }

  public async listSynopsisCandidates(
    workspaceRoot: StoryUri,
  ): Promise<readonly NoteSynopsisCandidate[]> {
    return (await this.store(workspaceRoot))
      .listByKind('absorb')
      .flatMap((record): NoteSynopsisCandidate[] => {
        const data: AbsorbSessionData = absorbDataOf(record);
        return record.elementId === undefined &&
          data.synopsisCandidate !== undefined &&
          data.location !== undefined
          ? [{ location: data.location, absorbedAt: record.updatedAt, markdown: data.synopsisCandidate }]
          : [];
      });
  }

  public async saveSynopsisCandidate(
    workspaceRoot: StoryUri,
    location: string,
    synopsis: OutlineSynopsis | undefined,
  ): Promise<void> {
    await this.updateAbsorbSession(workspaceRoot, location, (data) => {
      const { synopsisCandidate: _previous, ...rest } = data;
      return synopsis === undefined
        ? rest
        : { ...rest, synopsisCandidate: serializeSynopsisMarkdown(synopsis) };
    });
  }

  public async clearSynopsisCandidates(workspaceRoot: StoryUri, location?: string): Promise<void> {
    const store: SessionStore = await this.store(workspaceRoot);

    for (const record of store.listByKind('absorb')) {
      if (record.elementId === undefined && isOfLocation(record, location)) {
        const { synopsisCandidate: _previous, ...rest } = absorbDataOf(record);
        store.update(record.id, { data: rest, pendingCount: 0 });
      }
    }
  }

  public async addVoiceSeeds(
    workspaceRoot: StoryUri,
    sourceKind: NoteSourceKind,
    seeds: Readonly<Record<string, readonly NoteVoiceSeed[]>>,
  ): Promise<void> {
    for (const [characterId, lines] of Object.entries(seeds)) {
      const memory: ElementMemory = await this.cards.readMemory(
        workspaceRoot,
        'character',
        characterId,
        mainThreadId,
      );
      const known: Set<string> = new Set((memory.voiceSample ?? []).map((sample) => sample.text));
      const added: VoiceSampleLine[] = [];
      for (const seed of lines) {
        const text: string = seed.text.trim();
        if (text.length > 0 && !known.has(text)) {
          known.add(text);
          added.push({ text, source: describeNoteSource(sourceKind, seed.noteId) });
        }
      }
      await this.cards.writeMemory(workspaceRoot, 'character', characterId, mainThreadId, {
        ...memory,
        voiceSample: [...(memory.voiceSample ?? []), ...added],
      });
    }
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await new ProjectRepository(this.fileSystem).read(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async saveProject(workspaceRoot: StoryUri, project: StoryboardProject): Promise<void> {
    await new ProjectRepository(this.fileSystem).write(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
      project,
    );
  }

  private async updateAbsorbSession(
    workspaceRoot: StoryUri,
    location: string,
    change: (data: AbsorbSessionData) => AbsorbSessionData,
  ): Promise<void> {
    const store: SessionStore = await this.store(workspaceRoot);
    const id: string = absorbSessionId(location);
    const record: SessionRecord | undefined = store.find(id);
    const data: AbsorbSessionData = { ...change(absorbDataOf(record)), location };

    store.save({
      id,
      kind: 'absorb',
      openedAt: record?.openedAt ?? this.now().toISOString(),
      data,
      pendingCount: data.synopsisCandidate === undefined ? 0 : 1,
    });
  }

  private async store(workspaceRoot: StoryUri): Promise<SessionStore> {
    return new SessionStore(await this.caches.open(workspaceRoot));
  }
}
