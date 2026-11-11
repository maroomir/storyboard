import { normalizeCardListText, type StoryUri } from '@storyboard/story-model';

import type { BundleWarning, ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import { SceneRenumberer } from '#engine/persistence/bundles/sceneRenumberer';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { SceneRoster, WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface WorkspaceBundleAuditorDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
}

export interface SharedBackgroundAlias {
  readonly alias: string;
  readonly slugs: readonly string[];
}

export interface WorkspaceBundleAudit {
  readonly warnings: readonly BundleWarning[];
  readonly misnumberedScenes: readonly string[];
  readonly unusedBackgrounds: readonly string[];
  readonly sharedAliases: readonly SharedBackgroundAlias[];
}

function namesOf(bundle: ElementBundle): readonly string[] {
  const header: Readonly<Record<string, unknown>> = bundle.header as unknown as Readonly<Record<string, unknown>>;
  const aliases: readonly unknown[] = Array.isArray(header.aliases) ? header.aliases : [];

  return [header.name, ...aliases].filter((name): name is string => typeof name === 'string');
}

function findSharedAliases(backgrounds: readonly ElementBundle[]): SharedBackgroundAlias[] {
  const slugsByName: Map<string, { alias: string; slugs: Set<string> }> = new Map();
  for (const bundle of backgrounds) {
    for (const name of namesOf(bundle)) {
      const key: string = normalizeCardListText(name);
      const entry: { alias: string; slugs: Set<string> } = slugsByName.get(key) ?? { alias: name, slugs: new Set() };
      entry.slugs.add(bundle.header.slug);
      slugsByName.set(key, entry);
    }
  }

  return [...slugsByName.values()]
    .filter((entry) => entry.slugs.size > 1)
    .map((entry) => ({ alias: entry.alias, slugs: [...entry.slugs].sort() }));
}

function listPlacesInScenes(roster: SceneRoster): ReadonlySet<string> {
  return new Set(
    roster.entries.flatMap((entry) => [
      entry.content.header.place,
      ...entry.content.beats.map((beat) => beat.place),
    ]).filter((place): place is string => place !== undefined),
  );
}

export class WorkspaceBundleAuditor {
  public constructor(private readonly dependencies: WorkspaceBundleAuditorDependencies) {}

  public async audit(workspaceRoot: StoryUri): Promise<WorkspaceBundleAudit> {
    const cards: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    const scenes: SceneRoster = await this.dependencies.scenes.loadRoster(workspaceRoot);
    const backgrounds: readonly ElementBundle[] = cards.bundles.filter(
      (bundle) => bundle.header.kind === 'background',
    );
    const places: ReadonlySet<string> = listPlacesInScenes(scenes);

    return {
      warnings: await this.dependencies.cards.listWarnings(workspaceRoot),
      misnumberedScenes: await new SceneRenumberer(this.dependencies).listMisnumbered(workspaceRoot),
      unusedBackgrounds:
        scenes.entries.length === 0
          ? []
          : backgrounds.filter((bundle) => !places.has(bundle.header.id)).map((bundle) => bundle.header.slug),
      sharedAliases: findSharedAliases(backgrounds),
    };
  }
}
