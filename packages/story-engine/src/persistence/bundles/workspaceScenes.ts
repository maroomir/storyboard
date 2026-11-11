import { randomUUID } from 'node:crypto';

import {
  STORYBOARD_RELATIVE_PATHS,
  bundleFileNames,
  bundleFileRelativePath,
  elementKindDirectories,
  formatBundleDirectoryName,
  joinStoryPath,
  parseBundleDirectoryName,
  planSceneBundle,
  projectSceneFile,
  structureWithProjectThreads,
  type Beat,
  type BundleDirectoryNameParts,
  type PlannedSceneBundle,
  type SceneBeat,
  type SceneBundleContent,
  SceneParseError,
  type SceneCard,
  type SceneCastResolvers,
  type SceneFile,
  type SceneHeader,
  type SceneProjectionLookup,
  type SceneDialogueRecord,
  type SceneStoryState,
  type StatementSource,
  type StoryStructure,
  type StoryUri,
  type StructureSceneEntry,
} from '@storyboard/story-model';

import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import { ElementIndexStore } from '#engine/persistence/cache/elementIndexStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import { BundleFileAccess } from '#engine/persistence/bundles/bundleFileAccess';
import {
  ElementBundleRepository,
  type BundleListing,
  type BundleWarning,
  type ElementBundle,
} from '#engine/persistence/bundles/elementBundleRepository';
import { SceneBundleFiles } from '#engine/persistence/bundles/sceneBundleFiles';
import { StructureRepository } from '#engine/persistence/bundles/structureRepository';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export interface WorkspaceScenesDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
  readonly cards: WorkspaceCards;
}

type SceneBundle = ElementBundle & { readonly header: SceneHeader };

export interface SceneRosterEntry {
  readonly file: SceneFile;
  readonly content: SceneBundleContent;
  readonly path: string;
  readonly entry?: StructureSceneEntry;
}

export interface SceneRoster {
  readonly entries: readonly SceneRosterEntry[];
  readonly scenes: readonly SceneFile[];
  readonly structure: StoryStructure;
  readonly warnings: readonly BundleWarning[];
}

export interface WriteSceneCardOptions {
  readonly source: StatementSource;
  readonly slug?: string;
}

export interface WrittenScene {
  readonly stem: string;
  readonly uri: StoryUri;
  readonly isNew: boolean;
}

interface CachedSceneRoster {
  readonly fingerprint: string;
  readonly roster: SceneRoster;
}

interface PlacedBundle {
  readonly bundle: SceneBundle;
  readonly parts: BundleDirectoryNameParts;
  readonly entry?: StructureSceneEntry;
  readonly number: number;
}

const fingerprintedSceneFiles: readonly string[] = [
  bundleFileNames.card,
  bundleFileNames.statements,
  bundleFileNames.beats,
  bundleFileNames.summary,
];

function isSceneBundle(bundle: ElementBundle): bundle is SceneBundle {
  return bundle.header.kind === 'scene';
}

function directoryNameOf(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function stemOfDirectory(directoryName: string): string {
  return directoryName.slice(0, -'.card'.length);
}

function emptyStructure(): StoryStructure {
  return structureWithProjectThreads(undefined, undefined);
}

export class WorkspaceScenes {
  private readonly rosters: Map<string, CachedSceneRoster> = new Map();

  public constructor(private readonly dependencies: WorkspaceScenesDependencies) {}

  public async loadRoster(workspaceRoot: StoryUri): Promise<SceneRoster> {
    const key: string = workspaceRoot.toString();
    const fingerprint: string = await this.fingerprint(workspaceRoot);
    const cached: CachedSceneRoster | undefined = this.rosters.get(key);
    if (cached?.fingerprint === fingerprint) {
      return cached.roster;
    }

    const roster: SceneRoster = await this.readRoster(workspaceRoot);
    this.rosters.set(key, { fingerprint, roster });
    return roster;
  }

  public async find(workspaceRoot: StoryUri, reference: string): Promise<SceneRosterEntry | undefined> {
    const { entries } = await this.loadRoster(workspaceRoot);
    const trimmed: string = reference.trim();
    const asNumber: number | undefined = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;

    return (
      entries.find((entry) => entry.file.stem === trimmed) ??
      entries.find((entry) => asNumber !== undefined && entry.file.order === asNumber) ??
      entries.find((entry) => entry.file.slug === trimmed)
    );
  }

  public async read(workspaceRoot: StoryUri, stem: string): Promise<SceneFile | undefined> {
    return (await this.find(workspaceRoot, stem))?.file;
  }

  public async readByUri(sceneUri: StoryUri): Promise<SceneFile> {
    const location: SceneUriParts | undefined = splitSceneUri(sceneUri);
    if (location === undefined) {
      throw new SceneParseError(
        'invalid-scene-file-name',
        `씬 번들 경로가 아닙니다: ${sceneUri.path}`,
      );
    }

    const scene: SceneFile | undefined = await this.read(location.workspaceRoot, location.stem);
    if (scene === undefined) {
      throw new SceneParseError('missing-scene', `씬이 없습니다: ${location.stem}`);
    }

    return scene;
  }

  public async writeSlug(workspaceRoot: StoryUri, stem: string, slug: string): Promise<void> {
    const found: SceneRosterEntry | undefined = await this.find(workspaceRoot, stem);
    if (found === undefined) {
      throw new Error(`씬이 없습니다: ${stem}`);
    }

    this.rosters.clear();
    await (await this.openRepository(workspaceRoot)).writeBundle('scene', {
      directoryName: directoryNameOf(found.path),
      header: { ...found.content.header, slug },
      statements: found.content.statements,
    });
  }

  public async readStructure(workspaceRoot: StoryUri): Promise<StoryStructure> {
    return (await this.structureRepository(workspaceRoot).read()) ?? emptyStructure();
  }

  public async writeStructure(workspaceRoot: StoryUri, structure: StoryStructure): Promise<void> {
    this.rosters.clear();
    await this.structureRepository(workspaceRoot).write(structure);
  }

  public async relocateBundle(
    workspaceRoot: StoryUri,
    fromRelativePath: string,
    toRelativePath: string,
  ): Promise<void> {
    this.rosters.clear();
    const fromUri: StoryUri = joinStoryPath(workspaceRoot, ...fromRelativePath.split('/'));
    await this.copyDirectory(fromUri, joinStoryPath(workspaceRoot, ...toRelativePath.split('/')));
    await this.dependencies.fileSystem.delete(fromUri);
    (await this.openIndex(workspaceRoot)).remove(fromRelativePath);
  }

  public async removeBundle(workspaceRoot: StoryUri, relativePath: string): Promise<void> {
    this.rosters.clear();
    await this.dependencies.fileSystem.delete(
      joinStoryPath(workspaceRoot, ...relativePath.split('/')),
    );
    (await this.openIndex(workspaceRoot)).remove(relativePath);
  }

  public async rewriteContent(
    workspaceRoot: StoryUri,
    entry: SceneRosterEntry,
    content: SceneBundleContent,
  ): Promise<void> {
    await this.writeContent(workspaceRoot, directoryNameOf(entry.path), content);
  }

  public async writeBeatsByUri(sceneUri: StoryUri, beats: readonly SceneBeat[]): Promise<void> {
    const location: SceneUriParts | undefined = splitSceneUri(sceneUri);
    if (location === undefined) {
      throw new SceneParseError(
        'invalid-scene-file-name',
        `씬 번들 경로가 아닙니다: ${sceneUri.path}`,
      );
    }

    await this.writeBeats(location.workspaceRoot, location.stem, beats);
  }

  public async readState(
    workspaceRoot: StoryUri,
    stem: string,
  ): Promise<SceneStoryState | undefined> {
    const found: SceneRosterEntry | undefined = await this.find(workspaceRoot, stem);
    return found === undefined ? undefined : await this.bundleFiles(workspaceRoot).readState(found.path);
  }

  public async writeState(
    workspaceRoot: StoryUri,
    stem: string,
    state: SceneStoryState | undefined,
  ): Promise<void> {
    const found: SceneRosterEntry | undefined = await this.find(workspaceRoot, stem);
    if (found === undefined) {
      throw new Error(`씬이 없습니다: ${stem}`);
    }

    if (state !== undefined) {
      await this.bundleFiles(workspaceRoot).writeState(found.path, state);
      return;
    }

    const stateUri: StoryUri = joinStoryPath(
      workspaceRoot,
      ...bundleFileRelativePath(found.path, 'state').split('/'),
    );
    if (await this.dependencies.fileSystem.exists(stateUri)) {
      await this.dependencies.fileSystem.delete(stateUri);
    }
  }

  public async readDialogue(
    workspaceRoot: StoryUri,
    stem: string,
  ): Promise<SceneDialogueRecord | undefined> {
    const found: SceneRosterEntry | undefined = await this.find(workspaceRoot, stem);
    return found === undefined
      ? undefined
      : await this.bundleFiles(workspaceRoot).readDialogue(found.path);
  }

  public async writeDialogue(
    workspaceRoot: StoryUri,
    stem: string,
    record: SceneDialogueRecord,
  ): Promise<void> {
    const found: SceneRosterEntry | undefined = await this.find(workspaceRoot, stem);
    if (found === undefined) {
      throw new Error(`씬이 없습니다: ${stem}`);
    }

    await this.bundleFiles(workspaceRoot).writeDialogue(found.path, record);
  }

  public sceneUri(workspaceRoot: StoryUri, stem: string): StoryUri {
    return joinStoryPath(workspaceRoot, STORYBOARD_RELATIVE_PATHS.sceneDirectory, `${stem}.card`);
  }

  public async writeCard(
    workspaceRoot: StoryUri,
    card: SceneCard,
    options: WriteSceneCardOptions,
  ): Promise<WrittenScene> {
    const roster: SceneRoster = await this.loadRoster(workspaceRoot);
    const slug: string = options.slug ?? slugOfCard(card);
    const existing: SceneRosterEntry | undefined = roster.entries.find(
      (entry) => entry.file.slug === slug,
    );
    const cards: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    const planned: PlannedSceneBundle = planSceneBundle(card, {
      ...(existing === undefined ? {} : { current: existing.content }),
      newId: randomUUID(),
      slug,
      resolvers: this.resolversOf(cards),
      narratorIdOf: (narratorSlug) => cards.lookup.idOf('narrator', narratorSlug),
      source: options.source,
    });

    return existing === undefined
      ? await this.createScene(workspaceRoot, roster, planned)
      : await this.updateScene(workspaceRoot, roster, existing, planned);
  }

  public async writeBeats(
    workspaceRoot: StoryUri,
    stem: string,
    beats: readonly SceneBeat[],
  ): Promise<void> {
    const found: SceneRosterEntry | undefined = await this.find(workspaceRoot, stem);
    if (found === undefined) {
      throw new Error(`씬이 없습니다: ${stem}`);
    }

    const cards: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    const planned: PlannedSceneBundle = planSceneBundle(
      { ...found.file.card, beats: [...beats] },
      {
        current: found.content,
        newId: found.content.header.id,
        slug: found.file.slug,
        resolvers: this.resolversOf(cards),
        narratorIdOf: (narratorSlug) => cards.lookup.idOf('narrator', narratorSlug),
        source: { origin: 'studio' },
      },
    );
    this.rosters.clear();
    await this.bundleFiles(workspaceRoot).writeBeats(found.path, planned.content.beats);
  }

  private async createScene(
    workspaceRoot: StoryUri,
    roster: SceneRoster,
    planned: PlannedSceneBundle,
  ): Promise<WrittenScene> {
    const number: number = roster.structure.scenes.length + 1;
    const directoryName: string = formatBundleDirectoryName('scene', {
      slug: planned.content.header.slug,
      sceneNumber: number,
    });
    const entry: StructureSceneEntry = { scene: planned.content.header.id, ...planned.placement };

    await this.writeContent(workspaceRoot, directoryName, planned.content);
    await this.structureRepository(workspaceRoot).write({
      ...roster.structure,
      scenes: [...roster.structure.scenes, entry],
    });

    const stem: string = stemOfDirectory(directoryName);
    return { stem, uri: this.sceneUri(workspaceRoot, stem), isNew: true };
  }

  private async updateScene(
    workspaceRoot: StoryUri,
    roster: SceneRoster,
    existing: SceneRosterEntry,
    planned: PlannedSceneBundle,
  ): Promise<WrittenScene> {
    const directoryName: string = directoryNameOf(existing.path);
    const entry: StructureSceneEntry = { scene: planned.content.header.id, ...planned.placement };

    await this.writeContent(workspaceRoot, directoryName, planned.content);
    await this.structureRepository(workspaceRoot).write({
      ...roster.structure,
      scenes: roster.structure.scenes.some((scene) => scene.scene === entry.scene)
        ? roster.structure.scenes.map((scene) => (scene.scene === entry.scene ? entry : scene))
        : [...roster.structure.scenes, entry],
    });

    return { stem: existing.file.stem, uri: this.sceneUri(workspaceRoot, existing.file.stem), isNew: false };
  }

  private async writeContent(
    workspaceRoot: StoryUri,
    directoryName: string,
    content: SceneBundleContent,
  ): Promise<void> {
    this.rosters.clear();
    const written: ElementBundle = await (await this.openRepository(workspaceRoot)).writeBundle(
      'scene',
      { directoryName, header: content.header, statements: content.statements },
    );
    const files: SceneBundleFiles = this.bundleFiles(workspaceRoot);
    await files.writeBeats(written.path, content.beats);
    if (content.summaryText !== undefined) {
      await files.writeSummary(written.path, content.summaryText);
    }
  }

  private async readRoster(workspaceRoot: StoryUri): Promise<SceneRoster> {
    const listing: BundleListing = await (await this.openRepository(workspaceRoot)).listBundles([
      'scene',
    ]);
    const structure: StoryStructure =
      (await this.structureRepository(workspaceRoot).read()) ?? emptyStructure();
    const cards: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    const lookup: SceneProjectionLookup = this.lookupOf(cards, listing);
    const files: SceneBundleFiles = this.bundleFiles(workspaceRoot);
    const entries: SceneRosterEntry[] = [];

    for (const placed of this.placeBundles(listing, structure)) {
      const content: SceneBundleContent = await this.readContent(files, placed.bundle);
      const stem: string = stemOfDirectory(directoryNameOf(placed.bundle.path));
      entries.push({
        file: projectSceneFile(content, { stem, number: placed.number, ...(placed.entry === undefined ? {} : { entry: placed.entry }) }, lookup),
        content,
        path: placed.bundle.path,
        ...(placed.entry === undefined ? {} : { entry: placed.entry }),
      });
    }

    return { entries, scenes: entries.map((entry) => entry.file), structure, warnings: listing.warnings };
  }

  private placeBundles(listing: BundleListing, structure: StoryStructure): PlacedBundle[] {
    const bundles: SceneBundle[] = listing.bundles.filter(isSceneBundle);
    const placed: PlacedBundle[] = structure.scenes.flatMap((entry, index): PlacedBundle[] => {
      const bundle: SceneBundle | undefined = bundles.find((item) => item.header.id === entry.scene);
      const parts: BundleDirectoryNameParts | undefined =
        bundle === undefined ? undefined : parseBundleDirectoryName('scene', directoryNameOf(bundle.path));
      return bundle === undefined || parts === undefined ? [] : [{ bundle, parts, entry, number: index + 1 }];
    });
    const placedIds: ReadonlySet<string> = new Set(placed.map((item) => item.bundle.header.id));
    const unplaced: PlacedBundle[] = bundles
      .filter((bundle) => !placedIds.has(bundle.header.id))
      .flatMap((bundle): PlacedBundle[] => {
        const parts: BundleDirectoryNameParts | undefined = parseBundleDirectoryName(
          'scene',
          directoryNameOf(bundle.path),
        );
        return parts === undefined ? [] : [{ bundle, parts, number: parts.sceneNumber ?? 0 }];
      })
      .sort((left, right) => left.number - right.number);

    return [...placed, ...unplaced];
  }

  private async readContent(files: SceneBundleFiles, bundle: SceneBundle): Promise<SceneBundleContent> {
    const beats: readonly Beat[] = await files.readBeats(bundle.path);
    const summaryText: string | undefined = await files.readSummary(bundle.path);

    return {
      header: bundle.header,
      statements: bundle.statements,
      beats,
      ...(summaryText === undefined ? {} : { summaryText }),
    };
  }

  private lookupOf(cards: CardRoster, listing: BundleListing): SceneProjectionLookup {
    const nameById: Map<string, string> = new Map(
      [...cards.bundles, ...listing.bundles].map((bundle) => [
        bundle.header.id,
        'name' in bundle.header ? bundle.header.name : bundle.header.title,
      ]),
    );

    return {
      slugOf: cards.lookup.slugOf,
      idOf: cards.lookup.idOf,
      nameOf: (id) => nameById.get(id),
    };
  }

  private resolversOf(cards: CardRoster): SceneCastResolvers {
    return {
      characterIdOf: (reference) =>
        cards.lookup.idOf('character', reference) ??
        cards.bundles.find(
          (bundle) =>
            bundle.header.kind === 'character' &&
            (bundle.header.name === reference || (bundle.header.aliases ?? []).includes(reference)),
        )?.header.id,
      placeIdOf: (reference) =>
        cards.lookup.idOf('background', reference) ??
        cards.bundles.find(
          (bundle) =>
            bundle.header.kind === 'background' &&
            (bundle.header.name === reference || (bundle.header.aliases ?? []).includes(reference)),
        )?.header.id,
    };
  }

  private async fingerprint(workspaceRoot: StoryUri): Promise<string> {
    const { fileSystem } = this.dependencies;
    const directory: StoryUri = joinStoryPath(workspaceRoot, elementKindDirectories.scene);
    const structureTime: number = await fileSystem.modifiedTime(
      joinStoryPath(workspaceRoot, ...STORYBOARD_RELATIVE_PATHS.structure.split('/')),
    );
    const entries: FileSystemDirectoryEntry[] = (await fileSystem.exists(directory))
      ? await fileSystem.readDirectory(directory)
      : [];
    const parts: string[] = [`structure:${structureTime}`];

    for (const [name] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
      const times: number[] = await Promise.all(
        fingerprintedSceneFiles.map((fileName) =>
          fileSystem.modifiedTime(joinStoryPath(directory, name, fileName)),
        ),
      );
      parts.push(`${name}:${times.join(',')}`);
    }

    const cardsRoster: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    parts.push(`cards:${cardsRoster.bundles.map((bundle) => bundle.cardHash).join(',')}`);
    return parts.join('|');
  }

  private async copyDirectory(from: StoryUri, to: StoryUri): Promise<void> {
    const { fileSystem } = this.dependencies;
    await fileSystem.createDirectory(to);

    for (const [name, entry] of await fileSystem.readDirectory(from)) {
      const source: StoryUri = joinStoryPath(from, name);
      const target: StoryUri = joinStoryPath(to, name);
      if (entry.type === 'directory') {
        await this.copyDirectory(source, target);
      } else {
        await fileSystem.writeFile(target, await fileSystem.readFile(source));
      }
    }
  }

  private async openIndex(workspaceRoot: StoryUri): Promise<ElementIndexStore> {
    return new ElementIndexStore(await this.dependencies.caches.open(workspaceRoot));
  }

  private bundleFiles(workspaceRoot: StoryUri): SceneBundleFiles {
    return new SceneBundleFiles(
      new BundleFileAccess({ fileSystem: this.dependencies.fileSystem, workspaceRoot }),
    );
  }

  private structureRepository(workspaceRoot: StoryUri): StructureRepository {
    return new StructureRepository({ fileSystem: this.dependencies.fileSystem, workspaceRoot });
  }

  private async openRepository(workspaceRoot: StoryUri): Promise<ElementBundleRepository> {
    return new ElementBundleRepository({
      fileSystem: this.dependencies.fileSystem,
      workspaceRoot,
      index: await this.openIndex(workspaceRoot),
    });
  }
}

interface SceneUriParts {
  readonly workspaceRoot: StoryUri;
  readonly stem: string;
}

function splitSceneUri(sceneUri: StoryUri): SceneUriParts | undefined {
  const segments: string[] = sceneUri.path.split('/');
  const directoryName: string | undefined = segments.at(-1);
  const sceneDirectory: string | undefined = segments.at(-2);
  if (
    directoryName === undefined ||
    !directoryName.endsWith('.card') ||
    sceneDirectory !== STORYBOARD_RELATIVE_PATHS.sceneDirectory
  ) {
    return undefined;
  }

  return {
    workspaceRoot: sceneUri.with({ path: segments.slice(0, -2).join('/') }),
    stem: stemOfDirectory(directoryName),
  };
}

function slugOfCard(card: SceneCard): string {
  const match: RegExpExecArray | null = /^\d+-(.+)$/.exec(card.id);
  return match?.[1] ?? card.id;
}
