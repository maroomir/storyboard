import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { WorkspaceCaches, WorkspaceCards } from '@storyboard/story-engine';
import { NodeFileSystem, NodeSqlDatabaseHost } from '@storyboard/story-node';
import {
  NodeUri,
  bundleFileNames,
  bundleRelativePath,
  formatBundleDirectoryName,
  isBackgroundCard,
  parseCard,
  parseNarratorCard,
  planBackgroundBundle,
  planCharacterBundle,
  planNarratorBundle,
  serializeCard,
  serializeElementCard,
  serializeStatementsFile,
  type ElementBundleContent,
  type ElementHeader,
  type ElementKind,
  type ElementSlugLookup,
  type NarratorCard,
  type StatementSource,
  type StoryboardCard,
} from '@storyboard/story-model';

const fixtureSource: StatementSource = { origin: 'studio' };

export function testElementId(kind: ElementKind, slug: string): string {
  const hex: string = createHash('sha256').update(`${kind}:${slug}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const fixtureLookup: ElementSlugLookup = {
  slugOf: () => undefined,
  idOf: (kind, slug) => testElementId(kind, slug),
};

function writeBundle<THeader extends ElementHeader>(
  workspace: string,
  kind: ElementKind,
  content: ElementBundleContent<THeader>,
): string {
  const bundlePath: string = bundleRelativePath(
    kind,
    formatBundleDirectoryName(kind, { slug: content.header.slug }),
  );
  const directory: string = join(workspace, bundlePath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, bundleFileNames.card), serializeElementCard(content.header));
  writeFileSync(join(directory, bundleFileNames.statements), serializeStatementsFile(content.statements));
  return bundlePath;
}

export function writeCardBundle(workspace: string, card: StoryboardCard | NarratorCard): string {
  if (card.type === 'narrator') {
    return writeBundle(
      workspace,
      'narrator',
      planNarratorBundle(card, { newId: testElementId('narrator', card.id), lookup: fixtureLookup, source: fixtureSource }),
    );
  }

  if (isBackgroundCard(card)) {
    return writeBundle(
      workspace,
      'background',
      planBackgroundBundle(card, { newId: testElementId('background', card.id), lookup: fixtureLookup, source: fixtureSource }),
    );
  }

  return writeBundle(
    workspace,
    'character',
    planCharacterBundle(card, { newId: testElementId('character', card.id), lookup: fixtureLookup, source: fixtureSource }),
  );
}

export function writeCardBundleFromYaml(workspace: string, yamlText: string): string {
  const isNarrator: boolean = /^type:\s*narrator\s*$/m.test(yamlText);
  return writeCardBundle(workspace, isNarrator ? parseNarratorCard(yamlText) : parseCard(yamlText));
}

export function isLegacyCardPath(relativePath: string): boolean {
  return /^(character|background|narrator)\/[^/]+\.card$/.test(relativePath);
}

export async function readCardFromBundles(
  workspace: string,
  slug: string,
): Promise<StoryboardCard | undefined> {
  const caches: WorkspaceCaches = new WorkspaceCaches({
    host: new NodeSqlDatabaseHost(),
    fileSystem: new NodeFileSystem(),
  });
  try {
    return await new WorkspaceCards({ fileSystem: new NodeFileSystem(), caches }).findCard(
      NodeUri.file(workspace),
      slug,
    );
  } finally {
    await caches.closeAll();
  }
}

export function readBundleText(workspace: string, kind: ElementKind, slug: string): string {
  const directory: string = join(
    workspace,
    bundleRelativePath(kind, formatBundleDirectoryName(kind, { slug })),
  );
  return [bundleFileNames.card, bundleFileNames.statements]
    .map((fileName) => readFileSync(join(directory, fileName), 'utf8'))
    .join('\n---\n');
}

export async function readCardYaml(workspace: string, slug: string): Promise<string> {
  const card: StoryboardCard | undefined = await readCardFromBundles(workspace, slug);
  return card === undefined ? '' : serializeCard(card);
}
