import { randomUUID } from 'node:crypto';

import {
  bundleFileNames,
  bundleRelativePath,
  elementKindDirectories,
  formatBundleDirectoryName,
  isBackgroundCard,
  joinStoryPath,
  planBackgroundBundle,
  planCharacterBundle,
  planNarratorBundle,
  projectBackgroundCard,
  projectCharacterCard,
  projectNarratorCard,
  type BackgroundHeader,
  type CharacterCard,
  type CharacterHeader,
  type ElementBundleContent,
  type ElementMemory,
  type ElementHeader,
  type ElementKind,
  type ElementSlugLookup,
  type LocationBackgroundCard,
  type NarratorCard,
  type NarratorHeader,
  type StatementSource,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import { ElementIndexStore } from '#engine/persistence/cache/elementIndexStore';
import { BundleFileAccess } from '#engine/persistence/bundles/bundleFileAccess';
import { ElementMemoryRepository } from '#engine/persistence/bundles/elementMemoryRepository';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import {
  ElementBundleRepository,
  type BundleListing,
  type BundleWarning,
  type ElementBundle,
} from '#engine/persistence/bundles/elementBundleRepository';

export interface WorkspaceCardsDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
}

export interface CardRoster {
  readonly characters: readonly CharacterCard[];
  readonly backgrounds: readonly LocationBackgroundCard[];
  readonly narrators: readonly NarratorCard[];
  readonly bundles: readonly ElementBundle[];
  readonly warnings: readonly BundleWarning[];
  readonly lookup: ElementSlugLookup;
}

export type CardBundleKind = 'character' | 'background' | 'narrator';

export const cardBundleKinds: readonly CardBundleKind[] = ['character', 'background', 'narrator'];

const authorSource: StatementSource = { origin: 'author' };

const fingerprintedBundleFiles: readonly string[] = [
  bundleFileNames.card,
  bundleFileNames.statements,
];

interface CardWritePlan {
  readonly roster: CardRoster;
  readonly lookup: ElementSlugLookup;
  readonly newId: string;
  readonly source: StatementSource;
}

function kindOfCard(card: StoryboardCard): CardBundleKind {
  return isBackgroundCard(card) ? 'background' : 'character';
}

type CharacterBundle = ElementBundle & { readonly header: CharacterHeader };
type BackgroundBundle = ElementBundle & { readonly header: BackgroundHeader };
type NarratorBundle = ElementBundle & { readonly header: NarratorHeader };

function isCharacterBundle(bundle: ElementBundle): bundle is CharacterBundle {
  return bundle.header.kind === 'character';
}

function isBackgroundBundle(bundle: ElementBundle): bundle is BackgroundBundle {
  return bundle.header.kind === 'background';
}

function isNarratorBundle(bundle: ElementBundle): bundle is NarratorBundle {
  return bundle.header.kind === 'narrator';
}

function contentOf<THeader extends ElementHeader>(
  bundle: ElementBundle & { readonly header: THeader },
): ElementBundleContent<THeader> {
  return { header: bundle.header, statements: bundle.statements };
}

function optionalCurrent<THeader extends ElementHeader>(
  bundle: (ElementBundle & { readonly header: THeader }) | undefined,
): { readonly current?: ElementBundleContent<THeader> } {
  return bundle === undefined ? {} : { current: contentOf(bundle) };
}

function createLookup(bundles: readonly ElementBundle[]): ElementSlugLookup {
  const slugById: Map<string, string> = new Map(
    bundles.map((bundle) => [bundle.header.id, bundle.header.slug]),
  );
  const idBySlug: Map<string, string> = new Map(
    bundles.map((bundle) => [`${bundle.header.kind}:${bundle.header.slug}`, bundle.header.id]),
  );

  return {
    slugOf: (id) => slugById.get(id),
    idOf: (kind, slug) => idBySlug.get(`${kind}:${slug}`),
  };
}

interface CachedRoster {
  readonly fingerprint: string;
  readonly roster: CardRoster;
}

export class WorkspaceCards {
  private readonly rosters: Map<string, CachedRoster> = new Map();

  public constructor(private readonly dependencies: WorkspaceCardsDependencies) {}

  public async loadRoster(
    workspaceRoot: StoryUri,
    kinds: readonly ElementKind[] = cardBundleKinds,
  ): Promise<CardRoster> {
    const key: string = `${workspaceRoot.toString()}#${kinds.join(',')}`;
    const fingerprint: string = await this.fingerprintBundles(workspaceRoot, kinds);
    const cached: CachedRoster | undefined = this.rosters.get(key);
    if (cached?.fingerprint === fingerprint) {
      return cached.roster;
    }

    const roster: CardRoster = await this.readRoster(workspaceRoot, kinds);
    this.rosters.set(key, { fingerprint, roster });
    return roster;
  }

  private async readRoster(
    workspaceRoot: StoryUri,
    kinds: readonly ElementKind[],
  ): Promise<CardRoster> {
    const listing: BundleListing = await (await this.openRepository(workspaceRoot)).listBundles(
      kinds,
    );
    const lookup: ElementSlugLookup = createLookup(listing.bundles);

    return {
      characters: listing.bundles
        .filter(isCharacterBundle)
        .map((bundle) => projectCharacterCard(contentOf(bundle), lookup)),
      backgrounds: listing.bundles
        .filter(isBackgroundBundle)
        .map((bundle) => projectBackgroundCard(contentOf(bundle))),
      narrators: listing.bundles
        .filter(isNarratorBundle)
        .map((bundle) => projectNarratorCard(contentOf(bundle), lookup)),
      bundles: listing.bundles,
      warnings: listing.warnings,
      lookup,
    };
  }

  private async fingerprintBundles(
    workspaceRoot: StoryUri,
    kinds: readonly ElementKind[],
  ): Promise<string> {
    const { fileSystem } = this.dependencies;
    const parts: string[] = [];

    for (const kind of kinds) {
      const directory: StoryUri = joinStoryPath(workspaceRoot, elementKindDirectories[kind]);
      const entries: FileSystemDirectoryEntry[] = (await fileSystem.exists(directory))
        ? await fileSystem.readDirectory(directory)
        : [];
      for (const [name] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
        const bundle: StoryUri = joinStoryPath(directory, name);
        const times: number[] = await Promise.all(
          fingerprintedBundleFiles.map((fileName) =>
            fileSystem.modifiedTime(joinStoryPath(bundle, fileName)),
          ),
        );
        parts.push(`${kind}/${name}:${times.join(',')}`);
      }
    }

    return parts.join('|');
  }

  public async findCard(workspaceRoot: StoryUri, slug: string): Promise<StoryboardCard | undefined> {
    const roster: CardRoster = await this.loadRoster(workspaceRoot, ['character', 'background']);

    return (
      roster.characters.find((card) => card.id === slug) ??
      roster.backgrounds.find((card) => card.id === slug)
    );
  }

  public async exists(workspaceRoot: StoryUri, kind: CardBundleKind, slug: string): Promise<boolean> {
    return await this.dependencies.fileSystem.exists(this.bundleUri(workspaceRoot, kind, slug));
  }

  public async writeCard(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    source: StatementSource = authorSource,
  ): Promise<StoryUri> {
    const [written] = await this.writeCards(workspaceRoot, [card], source);
    if (written === undefined) {
      throw new Error(`카드를 쓰지 못했습니다: ${card.id}`);
    }

    return written;
  }

  public async writeCards(
    workspaceRoot: StoryUri,
    cards: readonly StoryboardCard[],
    source: StatementSource = authorSource,
  ): Promise<StoryUri[]> {
    const roster: CardRoster = await this.loadRoster(workspaceRoot);
    const newIds: Map<string, string> = new Map(
      cards
        .filter((card) => this.findBundle(roster, kindOfCard(card), card.id) === undefined)
        .map((card) => [`${kindOfCard(card)}:${card.id}`, randomUUID()]),
    );
    const lookup: ElementSlugLookup = {
      slugOf: roster.lookup.slugOf,
      idOf: (kind, slug) => roster.lookup.idOf(kind, slug) ?? newIds.get(`${kind}:${slug}`),
    };

    const written: StoryUri[] = [];
    for (const card of cards) {
      const newId: string = newIds.get(`${kindOfCard(card)}:${card.id}`) ?? randomUUID();
      written.push(await this.writePlannedCard(workspaceRoot, card, { roster, lookup, newId, source }));
    }

    return written;
  }

  public async writeNarrator(
    workspaceRoot: StoryUri,
    card: NarratorCard,
    source: StatementSource = authorSource,
  ): Promise<StoryUri> {
    const roster: CardRoster = await this.loadRoster(workspaceRoot);
    const current: NarratorBundle | undefined = roster.bundles
      .filter(isNarratorBundle)
      .find((bundle) => bundle.header.slug === card.id);
    const planned: ElementBundleContent<NarratorHeader> = planNarratorBundle(card, {
      ...optionalCurrent(current),
      newId: randomUUID(),
      lookup: roster.lookup,
      source,
    });

    return await this.writePlanned(workspaceRoot, 'narrator', card.id, planned);
  }

  public async remove(workspaceRoot: StoryUri, kind: CardBundleKind, slug: string): Promise<void> {
    this.rosters.clear();
    const index: ElementIndexStore = await this.openIndex(workspaceRoot);
    const path: string = this.bundlePath(kind, slug);

    await this.dependencies.fileSystem.delete(this.bundleUri(workspaceRoot, kind, slug));
    index.remove(path);
  }

  public async rename(
    workspaceRoot: StoryUri,
    kind: CardBundleKind,
    fromSlug: string,
    toSlug: string,
  ): Promise<StoryUri> {
    const roster: CardRoster = await this.loadRoster(workspaceRoot, [kind]);
    const current: ElementBundle | undefined = this.findBundle(roster, kind, fromSlug);
    if (current === undefined) {
      throw new Error(`카드가 없습니다: ${fromSlug}`);
    }

    const fromUri: StoryUri = this.bundleUri(workspaceRoot, kind, fromSlug);
    const toUri: StoryUri = this.bundleUri(workspaceRoot, kind, toSlug);
    this.rosters.clear();
    await this.copyDirectory(fromUri, toUri);
    await this.dependencies.fileSystem.delete(fromUri);
    (await this.openIndex(workspaceRoot)).remove(current.path);
    const renamed: ElementBundle = await (await this.openRepository(workspaceRoot)).writeBundle(
      kind,
      {
        directoryName: formatBundleDirectoryName(kind, { slug: toSlug }),
        header: { ...current.header, slug: toSlug },
        statements: current.statements,
      },
    );

    return joinStoryPath(workspaceRoot, ...renamed.path.split('/'));
  }

  public async readMemory(
    workspaceRoot: StoryUri,
    kind: CardBundleKind,
    slug: string,
    threadId: string,
  ): Promise<ElementMemory> {
    return await this.memoryRepository(workspaceRoot).read(this.bundlePath(kind, slug), threadId);
  }

  public async writeMemory(
    workspaceRoot: StoryUri,
    kind: CardBundleKind,
    slug: string,
    threadId: string,
    memory: ElementMemory,
  ): Promise<void> {
    await this.memoryRepository(workspaceRoot).write(this.bundlePath(kind, slug), threadId, memory);
  }

  public bundleUri(workspaceRoot: StoryUri, kind: CardBundleKind, slug: string): StoryUri {
    return joinStoryPath(workspaceRoot, ...this.bundlePath(kind, slug).split('/'));
  }

  private async writePlannedCard(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    plan: CardWritePlan,
  ): Promise<StoryUri> {
    const { roster, lookup, newId, source } = plan;

    if (isBackgroundCard(card)) {
      const current: BackgroundBundle | undefined = roster.bundles
        .filter(isBackgroundBundle)
        .find((bundle) => bundle.header.slug === card.id);
      return await this.writePlanned(
        workspaceRoot,
        'background',
        card.id,
        planBackgroundBundle(card, { ...optionalCurrent(current), newId, lookup, source }),
      );
    }

    const current: CharacterBundle | undefined = roster.bundles
      .filter(isCharacterBundle)
      .find((bundle) => bundle.header.slug === card.id);
    return await this.writePlanned(
      workspaceRoot,
      'character',
      card.id,
      planCharacterBundle(card, { ...optionalCurrent(current), newId, lookup, source }),
    );
  }

  private memoryRepository(workspaceRoot: StoryUri): ElementMemoryRepository {
    return new ElementMemoryRepository(
      new BundleFileAccess({ fileSystem: this.dependencies.fileSystem, workspaceRoot }),
    );
  }

  private bundlePath(kind: CardBundleKind, slug: string): string {
    return bundleRelativePath(kind, formatBundleDirectoryName(kind, { slug }));
  }

  private findBundle(
    roster: CardRoster,
    kind: CardBundleKind,
    slug: string,
  ): ElementBundle | undefined {
    return roster.bundles.find(
      (bundle) => bundle.header.kind === kind && bundle.header.slug === slug,
    );
  }

  private async writePlanned<THeader extends ElementHeader>(
    workspaceRoot: StoryUri,
    kind: CardBundleKind,
    slug: string,
    planned: ElementBundleContent<THeader>,
  ): Promise<StoryUri> {
    this.rosters.clear();
    const written: ElementBundle = await (await this.openRepository(workspaceRoot)).writeBundle(
      kind,
      {
        directoryName: formatBundleDirectoryName(kind, { slug }),
        header: planned.header,
        statements: planned.statements,
      },
    );

    return joinStoryPath(workspaceRoot, ...written.path.split('/'), 'card.yaml');
  }

  private async copyDirectory(from: StoryUri, to: StoryUri): Promise<void> {
    const { fileSystem } = this.dependencies;
    await fileSystem.createDirectory(to);

    const entries: FileSystemDirectoryEntry[] = await fileSystem.readDirectory(from);
    for (const [name, entry] of entries) {
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

  private async openRepository(workspaceRoot: StoryUri): Promise<ElementBundleRepository> {
    return new ElementBundleRepository({
      fileSystem: this.dependencies.fileSystem,
      workspaceRoot,
      index: await this.openIndex(workspaceRoot),
    });
  }
}
