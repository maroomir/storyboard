import { randomUUID } from 'node:crypto';

import {
  BundleFileError,
  bundleFileNames,
  bundleRelativePath,
  elementKindDirectories,
  elementKinds,
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
  type Statement,
} from '@storyboard/story-model';

import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { ElementIndexStore } from '#engine/persistence/cache/elementIndexStore';
import { BundleFileAccess } from '#engine/persistence/bundles/bundleFileAccess';
import { ElementMemoryRepository } from '#engine/persistence/bundles/elementMemoryRepository';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import {
  ElementBundleRepository,
  type BundleListing,
  type BundleReading,
  type BundleWarning,
  type ElementBundle,
} from '#engine/persistence/bundles/elementBundleRepository';

export interface WorkspaceCardsDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
  readonly logger?: IStoryboardLogger;
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

export interface PlannedCardChanges {
  readonly statements: readonly Statement[];
  readonly header?: Readonly<Record<string, unknown>>;
}

interface PlannedCard {
  readonly kind: 'character' | 'background';
  readonly content: ElementBundleContent<ElementHeader>;
}

const reportedWarningKinds: ReadonlySet<BundleWarning['kind']> = new Set([
  'changed-outside-engine',
  'unreadable',
  'copied-id',
]);

function isUnreadableBundleOf(warning: BundleWarning, slug: string): boolean {
  return warning.kind === 'unreadable' && warning.paths.some((path) => path.includes(`/${slug}.card/`));
}

interface CachedRoster {
  readonly fingerprint: string;
  readonly roster: CardRoster;
}

export class WorkspaceCards {
  private readonly rosters: Map<string, CachedRoster> = new Map();
  private readonly outsideChanges: Map<string, readonly BundleWarning[]> = new Map();

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
    this.reportWarnings(workspaceRoot, listing.warnings);

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

  private reportWarnings(workspaceRoot: StoryUri, warnings: readonly BundleWarning[]): void {
    for (const warning of warnings.filter((item) => reportedWarningKinds.has(item.kind))) {
      this.dependencies.logger?.warn(warning.message);
    }

    const outside: readonly BundleWarning[] = warnings.filter((item) => item.kind === 'changed-outside-engine');
    if (outside.length > 0) {
      const key: string = workspaceRoot.toString();
      this.outsideChanges.set(key, [...(this.outsideChanges.get(key) ?? []), ...outside]);
    }
  }

  private throwIfUnreadable(roster: CardRoster, slug: string): void {
    const unreadable: BundleWarning | undefined = roster.warnings.find((warning) =>
      isUnreadableBundleOf(warning, slug),
    );
    if (unreadable !== undefined) {
      throw new BundleFileError('invalid-shape', unreadable.paths[0] ?? slug, unreadable.message);
    }
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
    const card: StoryboardCard | undefined =
      roster.characters.find((candidate) => candidate.id === slug) ??
      roster.backgrounds.find((candidate) => candidate.id === slug);
    if (card === undefined) {
      this.throwIfUnreadable(roster, slug);
    }

    return card;
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

  public async listWarnings(workspaceRoot: StoryUri): Promise<readonly BundleWarning[]> {
    const fresh: readonly BundleWarning[] = (
      await (await this.openRepository(workspaceRoot)).listBundles(elementKinds)
    ).warnings;
    const key: string = workspaceRoot.toString();
    const seenOutside: readonly BundleWarning[] = (this.outsideChanges.get(key) ?? []).filter(
      (kept) => !fresh.some((warning) => warning.message === kept.message),
    );
    this.outsideChanges.delete(key);

    return [...seenOutside, ...fresh];
  }

  public async reassignCopiedIds(workspaceRoot: StoryUri): Promise<readonly string[]> {
    const repository: ElementBundleRepository = await this.openRepository(workspaceRoot);
    const listing: BundleListing = await repository.listBundles(elementKinds);
    const reassigned: string[] = [];

    for (const warning of listing.warnings.filter((item) => item.kind === 'copied-id')) {
      const copies: readonly ElementBundle[] = await this.orderByAge(
        workspaceRoot,
        listing.bundles.filter((bundle) => warning.paths.includes(bundle.path)),
      );
      for (const copy of copies.slice(1)) {
        await repository.writeBundle(copy.header.kind, {
          directoryName: copy.path.split('/').at(-1) ?? copy.path,
          header: { ...copy.header, id: randomUUID() },
          statements: copy.statements,
        });
        reassigned.push(copy.path);
      }
    }

    this.rosters.clear();
    return reassigned;
  }

  private async orderByAge(
    workspaceRoot: StoryUri,
    bundles: readonly ElementBundle[],
  ): Promise<readonly ElementBundle[]> {
    const aged: { readonly bundle: ElementBundle; readonly modifiedAt: number }[] = [];
    for (const bundle of bundles) {
      const cardUri: StoryUri = joinStoryPath(workspaceRoot, ...bundle.path.split('/'), bundleFileNames.card);
      aged.push({ bundle, modifiedAt: await this.dependencies.fileSystem.modifiedTime(cardUri) });
    }

    return aged
      .sort((left, right) => left.modifiedAt - right.modifiedAt || left.bundle.path.localeCompare(right.bundle.path))
      .map((item) => item.bundle);
  }

  public async findBundleBySlug(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<ElementBundle | undefined> {
    const roster: CardRoster = await this.loadRoster(workspaceRoot);
    const bundle: ElementBundle | undefined = roster.bundles.find((candidate) => candidate.header.slug === slug);
    if (bundle === undefined) {
      this.throwIfUnreadable(roster, slug);
    }

    return bundle;
  }

  public async readBundleAt(
    workspaceRoot: StoryUri,
    kind: ElementKind,
    directoryName: string,
  ): Promise<BundleReading> {
    return await (await this.openRepository(workspaceRoot)).readBundle(kind, directoryName);
  }

  public async rewriteBundle(
    workspaceRoot: StoryUri,
    bundle: ElementBundle,
    content: Pick<ElementBundle, 'header' | 'statements'>,
  ): Promise<void> {
    this.rosters.clear();
    await (await this.openRepository(workspaceRoot)).writeBundle(bundle.header.kind, {
      directoryName: bundle.path.split('/').at(-1) ?? bundle.path,
      header: content.header,
      statements: content.statements,
    });
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

  public async planCardChanges(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    source: StatementSource,
  ): Promise<PlannedCardChanges> {
    const roster: CardRoster = await this.loadRoster(workspaceRoot);
    const current: ElementBundle | undefined = this.findBundle(roster, kindOfCard(card), card.id);
    const planned: PlannedCard = this.planCard(card, {
      roster,
      lookup: roster.lookup,
      newId: current?.header.id ?? randomUUID(),
      source,
    });
    const currentLines: ReadonlySet<string> = new Set(
      (current?.statements ?? []).map((statement) => JSON.stringify(statement)),
    );
    const currentHeader: Readonly<Record<string, unknown>> = { ...(current?.header ?? {}) };
    const header: Record<string, unknown> = Object.fromEntries(
      Object.entries(planned.content.header).filter(
        ([key, value]) => JSON.stringify(currentHeader[key]) !== JSON.stringify(value),
      ),
    );

    return {
      statements: planned.content.statements.filter(
        (statement) => !currentLines.has(JSON.stringify(statement)),
      ),
      ...(Object.keys(header).length === 0 ? {} : { header }),
    };
  }

  private async writePlannedCard(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    plan: CardWritePlan,
  ): Promise<StoryUri> {
    const planned: PlannedCard = this.planCard(card, plan);
    return await this.writePlanned(workspaceRoot, planned.kind, card.id, planned.content);
  }

  private planCard(card: StoryboardCard, plan: CardWritePlan): PlannedCard {
    const { roster, lookup, newId, source } = plan;

    if (isBackgroundCard(card)) {
      const current: BackgroundBundle | undefined = roster.bundles
        .filter(isBackgroundBundle)
        .find((bundle) => bundle.header.slug === card.id);
      return {
        kind: 'background',
        content: planBackgroundBundle(card, { ...optionalCurrent(current), newId, lookup, source }),
      };
    }

    const current: CharacterBundle | undefined = roster.bundles
      .filter(isCharacterBundle)
      .find((bundle) => bundle.header.slug === card.id);
    return {
      kind: 'character',
      content: planCharacterBundle(card, { ...optionalCurrent(current), newId, lookup, source }),
    };
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
