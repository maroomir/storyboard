import {
  BundleFileError,
  bundleFileNames,
  bundleRelativePath,
  elementKindDirectories,
  elementKinds,
  findStatementsOutsideKind,
  isKnownBundleEntry,
  joinStoryPath,
  parseBundleDirectoryName,
  parseElementCard,
  parseStatementsFile,
  serializeElementCard,
  serializeStatementsFile,
  type BundleDirectoryNameParts,
  type ElementHeader,
  type ElementKind,
  type Statement,
  type StatementKindIssue,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  ElementIndexStore,
  IndexedElement,
} from '#engine/persistence/cache/elementIndexStore';
import { computeBundleCardHash } from '#engine/persistence/bundles/bundleContentHash';

export interface ElementBundle {
  readonly kind: ElementKind;
  readonly path: string;
  readonly header: ElementHeader;
  readonly statements: readonly Statement[];
  readonly cardHash: string;
}

export type BundleWarningKind =
  | 'unknown-entry'
  | 'changed-outside-engine'
  | 'slug-mismatch'
  | 'copied-id'
  | 'unreadable';

export interface BundleWarning {
  readonly kind: BundleWarningKind;
  readonly paths: readonly string[];
  readonly message: string;
}

export interface BundleReading {
  readonly bundle: ElementBundle;
  readonly warnings: readonly BundleWarning[];
}

export interface BundleListing {
  readonly bundles: readonly ElementBundle[];
  readonly warnings: readonly BundleWarning[];
}

export interface WriteBundleRequest {
  readonly directoryName: string;
  readonly header: ElementHeader;
  readonly statements: readonly Statement[];
}

export interface ElementBundleRepositoryDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
  readonly index: ElementIndexStore;
}

export type BundleWriteErrorCode = 'copied-id' | 'invalid-directory';

export class BundleWriteError extends Error {
  public constructor(
    public readonly code: BundleWriteErrorCode,
    public readonly paths: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = 'BundleWriteError';
  }
}

interface BundleTexts {
  readonly cardText: string;
  readonly statementsText: string;
}

function describeKindIssues(path: string, issues: readonly StatementKindIssue[]): string {
  const facets: string = issues
    .map((issue) => `${issue.index + 1}번째 줄 ${issue.facet}`)
    .join(', ');
  return `${path} 에 이 종류가 가질 수 없는 진술이 있습니다: ${facets}`;
}

function findCopiedIdWarnings(bundles: readonly ElementBundle[]): readonly BundleWarning[] {
  const pathsById: Map<string, string[]> = new Map<string, string[]>();
  for (const bundle of bundles) {
    pathsById.set(bundle.header.id, [...(pathsById.get(bundle.header.id) ?? []), bundle.path]);
  }

  return [...pathsById.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => ({
      kind: 'copied-id',
      paths,
      message: `두 폴더가 같은 uuid 를 씁니다: ${paths.join(', ')} (storyboard init --repair 가 나중 폴더에 새 uuid 를 줍니다)`,
    }));
}

export class ElementBundleRepository {
  public constructor(private readonly dependencies: ElementBundleRepositoryDependencies) {}

  public async listBundles(kinds: readonly ElementKind[] = elementKinds): Promise<BundleListing> {
    const readings: BundleReading[] = [];
    const unreadable: BundleWarning[] = [];
    for (const kind of kinds) {
      for (const directoryName of await this.listBundleDirectoryNames(kind)) {
        const reading: BundleReading | BundleWarning = await this.readBundleOrWarning(
          kind,
          directoryName,
        );
        if ('bundle' in reading) {
          readings.push(reading);
        } else {
          unreadable.push(reading);
        }
      }
    }

    const bundles: readonly ElementBundle[] = readings.map((reading) => reading.bundle);

    return {
      bundles,
      warnings: [
        ...unreadable,
        ...readings.flatMap((reading) => reading.warnings),
        ...findCopiedIdWarnings(bundles),
      ],
    };
  }

  private async readBundleOrWarning(
    kind: ElementKind,
    directoryName: string,
  ): Promise<BundleReading | BundleWarning> {
    try {
      return await this.readBundle(kind, directoryName);
    } catch (error) {
      if (!(error instanceof BundleFileError)) {
        throw error;
      }
      return { kind: 'unreadable', paths: [error.fileName], message: error.message };
    }
  }

  public async readBundle(kind: ElementKind, directoryName: string): Promise<BundleReading> {
    const path: string = bundleRelativePath(kind, directoryName);
    const texts: BundleTexts = await this.readBundleTexts(path);
    const bundle: ElementBundle = this.parseBundle(kind, path, texts);
    const warnings: readonly BundleWarning[] = [
      ...(await this.findUnknownEntries(kind, path)),
      ...this.findSlugMismatch(kind, directoryName, bundle),
      ...this.findOutsideChange(bundle),
    ];
    this.dependencies.index.upsert(this.toIndexedElement(bundle));

    return { bundle, warnings };
  }

  public async writeBundle(kind: ElementKind, request: WriteBundleRequest): Promise<ElementBundle> {
    const path: string = this.requireWritablePath(kind, request);
    const texts: BundleTexts = {
      cardText: serializeElementCard(request.header),
      statementsText: serializeStatementsFile(request.statements),
    };
    const bundleUri: StoryUri = this.uriOf(path);
    await this.dependencies.fileSystem.createDirectory(bundleUri);
    await this.dependencies.fileSystem.writeFile(
      joinStoryPath(bundleUri, bundleFileNames.card),
      new TextEncoder().encode(texts.cardText),
    );
    await this.dependencies.fileSystem.writeFile(
      joinStoryPath(bundleUri, bundleFileNames.statements),
      new TextEncoder().encode(texts.statementsText),
    );

    const bundle: ElementBundle = this.parseBundle(kind, path, texts);
    this.dependencies.index.upsert(this.toIndexedElement(bundle));

    return bundle;
  }

  private async listBundleDirectoryNames(kind: ElementKind): Promise<readonly string[]> {
    const kindDirectory: StoryUri = this.uriOf(elementKindDirectories[kind]);
    if (!(await this.dependencies.fileSystem.exists(kindDirectory))) {
      return [];
    }

    return (await this.dependencies.fileSystem.readDirectory(kindDirectory))
      .filter(
        ([name, entry]) =>
          entry.type === 'directory' && parseBundleDirectoryName(kind, name) !== undefined,
      )
      .map(([name]) => name)
      .sort();
  }

  private async readBundleTexts(path: string): Promise<BundleTexts> {
    const bundleUri: StoryUri = this.uriOf(path);
    const cardUri: StoryUri = joinStoryPath(bundleUri, bundleFileNames.card);
    const statementsUri: StoryUri = joinStoryPath(bundleUri, bundleFileNames.statements);
    if (!(await this.dependencies.fileSystem.exists(cardUri))) {
      const cardPath: string = `${path}/${bundleFileNames.card}`;
      throw new BundleFileError('missing-file', cardPath, `${cardPath} 이 없습니다.`);
    }

    const hasStatements: boolean = await this.dependencies.fileSystem.exists(statementsUri);

    return {
      cardText: new TextDecoder().decode(await this.dependencies.fileSystem.readFile(cardUri)),
      statementsText: hasStatements
        ? new TextDecoder().decode(await this.dependencies.fileSystem.readFile(statementsUri))
        : '',
    };
  }

  private parseBundle(kind: ElementKind, path: string, texts: BundleTexts): ElementBundle {
    const header: ElementHeader = parseElementCard(
      kind,
      texts.cardText,
      `${path}/${bundleFileNames.card}`,
    );
    const statementsPath: string = `${path}/${bundleFileNames.statements}`;
    const statements: readonly Statement[] = parseStatementsFile(
      texts.statementsText,
      statementsPath,
    );
    const kindIssues: readonly StatementKindIssue[] = findStatementsOutsideKind(kind, statements);
    if (kindIssues.length > 0) {
      throw new BundleFileError(
        'invalid-shape',
        statementsPath,
        describeKindIssues(statementsPath, kindIssues),
      );
    }

    return {
      kind,
      path,
      header,
      statements,
      cardHash: computeBundleCardHash(texts.cardText, texts.statementsText),
    };
  }

  private async findUnknownEntries(
    kind: ElementKind,
    path: string,
  ): Promise<readonly BundleWarning[]> {
    return (await this.dependencies.fileSystem.readDirectory(this.uriOf(path)))
      .map(([name]) => name)
      .filter((name) => !isKnownBundleEntry(kind, name))
      .map((name) => ({
        kind: 'unknown-entry',
        paths: [`${path}/${name}`],
        message: `번들이 모르는 파일입니다(그대로 둡니다): ${path}/${name}`,
      }));
  }

  private findSlugMismatch(
    kind: ElementKind,
    directoryName: string,
    bundle: ElementBundle,
  ): readonly BundleWarning[] {
    const parts: BundleDirectoryNameParts | undefined = parseBundleDirectoryName(
      kind,
      directoryName,
    );
    return parts === undefined || parts.slug === bundle.header.slug
      ? []
      : [
          {
            kind: 'slug-mismatch',
            paths: [bundle.path],
            message: `폴더 이름(${parts.slug})과 card.yaml 의 slug(${bundle.header.slug})가 다릅니다: ${bundle.path}`,
          },
        ];
  }

  private findOutsideChange(bundle: ElementBundle): readonly BundleWarning[] {
    const indexed: IndexedElement | undefined = this.dependencies.index.findByPath(bundle.path);
    return indexed === undefined || indexed.cardHash === bundle.cardHash
      ? []
      : [
          {
            kind: 'changed-outside-engine',
            paths: [bundle.path],
            message: `엔진 밖에서 바뀐 카드를 읽었습니다: ${bundle.path}`,
          },
        ];
  }

  private requireWritablePath(kind: ElementKind, request: WriteBundleRequest): string {
    const path: string = bundleRelativePath(kind, request.directoryName);
    if (parseBundleDirectoryName(kind, request.directoryName) === undefined) {
      throw new BundleWriteError(
        'invalid-directory',
        [path],
        `${kind} 번들 폴더 이름이 아닙니다: ${path}`,
      );
    }

    const otherPaths: readonly string[] = this.dependencies.index
      .findById(request.header.id)
      .map((element) => element.path)
      .filter((indexedPath) => indexedPath !== path);
    if (otherPaths.length > 0) {
      const paths: readonly string[] = [path, ...otherPaths];
      throw new BundleWriteError(
        'copied-id',
        paths,
        `같은 uuid 를 쓰는 폴더가 있어 쓰지 않습니다: ${paths.join(', ')} (storyboard init --repair 로 나중 폴더에 새 uuid 를 주세요)`,
      );
    }

    return path;
  }

  private toIndexedElement(bundle: ElementBundle): IndexedElement {
    return {
      id: bundle.header.id,
      kind: bundle.kind,
      slug: bundle.header.slug,
      path: bundle.path,
      cardHash: bundle.cardHash,
    };
  }

  private uriOf(relativePath: string): StoryUri {
    return joinStoryPath(this.dependencies.workspaceRoot, ...relativePath.split('/'));
  }
}
