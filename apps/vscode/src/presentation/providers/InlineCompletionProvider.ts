import { SceneContextReader } from '@storyboard/story-engine';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import type { AiGateway } from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  isDraftMarkdownFile,
  sceneFilePath,
  sceneContextPaths,
  STORYBOARD_GLOBS,
  parseDraft,
  readSceneFile,
} from '@storyboard/story-model';
import type {
  BackgroundCard,
  CharacterCard,
  SceneContext,
  SceneContextWorkspacePaths,
  SceneFile,
  SceneFileNameParts,
  StoryUri,
} from '@storyboard/story-model';
import { vscodeFsAdapter } from '@/infrastructure/vscode/workspaceFsAdapters';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import type { ConfigBridge } from '@storyboard/story-ai';
import { isTaskProviderReady } from '@/infrastructure/ai/providerReadiness';
import type { InlineCompletionContext } from '@storyboard/story-ai';
import { parseDraftSceneParts } from '@/infrastructure/vscode/draftSceneLink';

const inlineCompletionDelayMs: number = 700;
const inlineCompletionPrefixChars: number = 1200;
const inlineCompletionCacheLimit: number = 100;
const inlineSceneContextTtlMs: number = 60_000;
const inlineSceneIntentChars: number = 300;
const inlineMaxActiveCharacters: number = 3;

export interface DraftInlineCompletionProviderDependencies {
  readonly aiGateway: AiGateway;
  readonly configBridge: ConfigBridge;
}

interface InlineCompletionCacheValue {
  readonly value: string;
  readonly updatedAt: number;
}

interface CachedSceneContext {
  readonly context: InlineCompletionContext;
  readonly cachedAt: number;
}

export function formatInlineSceneContext(
  characters: readonly CharacterCard[],
  background: BackgroundCard | undefined,
  sceneBody: string,
): InlineCompletionContext {
  return {
    activeCharacter: formatActiveCharacters(characters),
    background: formatSceneBackground(background),
    sceneIntent: formatSceneIntent(sceneBody),
  };
}

function formatActiveCharacters(characters: readonly CharacterCard[]): string | undefined {
  const labels: string[] = characters.slice(0, inlineMaxActiveCharacters).map((character) => {
    const voice: string | undefined = character.voice?.[0]?.trim();
    return voice ? `${character.name}(${voice})` : character.name;
  });

  return labels.length > 0 ? labels.join(', ') : undefined;
}

function formatSceneBackground(background: BackgroundCard | undefined): string | undefined {
  if (!background) {
    return undefined;
  }

  const description: string | undefined = background.description[0]?.trim();
  return description ? `${background.name} — ${description}` : background.name;
}

function formatSceneIntent(sceneBody: string): string | undefined {
  const trimmed: string = sceneBody.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.length <= inlineSceneIntentChars
    ? trimmed
    : trimmed.slice(0, inlineSceneIntentChars).trim();
}

export function trimInlineCompletionPrefix(text: string): string {
  if (text.length <= inlineCompletionPrefixChars) {
    return text;
  }

  return text.slice(-inlineCompletionPrefixChars);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveStoryboardWorkspaceFolder(
  documentUri: vscode.Uri,
): Promise<vscode.WorkspaceFolder | undefined> {
  if (documentUri.scheme !== 'file') {
    return undefined;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(documentUri);
  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    return undefined;
  }

  return workspaceFolder;
}

export function createInlineCompletionCacheKey(
  document: vscode.TextDocument,
  position: vscode.Position,
  prefix: string,
): string {
  return `${document.uri.toString()}::${position.line}:${position.character}::${prefix}`;
}

export function pruneInlineCompletionCache(cache: Map<string, InlineCompletionCacheValue>): void {
  if (cache.size <= inlineCompletionCacheLimit) {
    return;
  }

  const sorted: [string, InlineCompletionCacheValue][] = [...cache.entries()].sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  const removeCount: number = cache.size - inlineCompletionCacheLimit;

  for (let index: number = 0; index < removeCount; index += 1) {
    const key: string | undefined = sorted[index]?.[0];
    if (key) {
      cache.delete(key);
    }
  }
}

export class DraftInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache: Map<string, InlineCompletionCacheValue> = new Map<
    string,
    InlineCompletionCacheValue
  >();
  private readonly sceneContextCache: Map<string, CachedSceneContext> = new Map<
    string,
    CachedSceneContext
  >();

  public constructor(private readonly dependencies: DraftInlineCompletionProviderDependencies) {}

  public register(): vscode.Disposable {
    const selector: vscode.DocumentSelector = {
      scheme: 'file',
      pattern: STORYBOARD_GLOBS.anyDraftMarkdown,
    };
    return vscode.languages.registerInlineCompletionItemProvider(selector, this);
  }

  private canCompleteDraft(
    documentUri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
  ): boolean {
    return (
      isDraftMarkdownFile(documentUri, workspaceFolder) &&
      isTaskProviderReady(this.dependencies.configBridge, 'inlineCompletion')
    );
  }

  private async loadSceneContext(
    document: vscode.TextDocument,
    workspaceFolder: vscode.WorkspaceFolder,
    sceneStem: string,
  ): Promise<InlineCompletionContext> {
    const cached: CachedSceneContext | undefined = this.sceneContextCache.get(sceneStem);
    if (cached && Date.now() - cached.cachedAt < inlineSceneContextTtlMs) {
      return cached.context;
    }

    const context: InlineCompletionContext = await this.readSceneContext(document, workspaceFolder);
    this.sceneContextCache.set(sceneStem, { context, cachedAt: Date.now() });
    return context;
  }

  private async readSceneContext(
    document: vscode.TextDocument,
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<InlineCompletionContext> {
    const parts: SceneFileNameParts | undefined = parseDraftSceneParts(document.getText());
    if (!parts) {
      return {};
    }

    try {
      const sceneUri: StoryUri = sceneFilePath(workspaceFolder.uri, parts.orderText, parts.slug);
      const fileName: string = sceneUri.path.split('/').pop() ?? '';
      const scene: SceneFile = await readSceneFile(sceneUri, vscodeFsAdapter, fileName);

      const paths: SceneContextWorkspacePaths = sceneContextPaths(
        getStoryboardProjectPaths(workspaceFolder.uri),
      );
      const sceneContext: SceneContext = await new SceneContextReader(vscodeFileSystem).build(
        paths,
        scene,
      );

      return formatInlineSceneContext(sceneContext.characters, sceneContext.background, scene.body);
    } catch {
      return {};
    }
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      await resolveStoryboardWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }
    if (!this.canCompleteDraft(document.uri, workspaceFolder)) {
      return undefined;
    }

    const fullPrefix: string = document.getText(
      new vscode.Range(new vscode.Position(0, 0), position),
    );
    const prefix: string = trimInlineCompletionPrefix(fullPrefix).trim();
    if (prefix.length === 0) {
      return undefined;
    }

    const cacheKey: string = createInlineCompletionCacheKey(document, position, prefix);
    const cached: InlineCompletionCacheValue | undefined = this.cache.get(cacheKey);
    if (cached) {
      return [new vscode.InlineCompletionItem(cached.value, new vscode.Range(position, position))];
    }

    await sleep(inlineCompletionDelayMs);
    if (token.isCancellationRequested) {
      return undefined;
    }

    let sceneStem: string = 'unknown-scene';
    try {
      sceneStem = parseDraft(document.getText()).sceneStem;
    } catch {
      const fileName: string = document.uri.path.split('/').pop() ?? '';
      sceneStem = fileName.replace(/\.md$/i, '');
    }

    const sceneContext: InlineCompletionContext = await this.loadSceneContext(
      document,
      workspaceFolder,
      sceneStem,
    );
    if (token.isCancellationRequested) {
      return undefined;
    }

    const completion: string = await this.dependencies.aiGateway
      .createService(workspaceFolder.uri)
      .completeInline(prefix, sceneContext, {
        providerId: this.dependencies.aiGateway.getTaskProvider('inlineCompletion'),
        attribution: { primary: { kind: 'scene', id: sceneStem } },
      });

    if (token.isCancellationRequested || completion.trim().length === 0) {
      return undefined;
    }

    this.cache.set(cacheKey, { value: completion, updatedAt: Date.now() });
    pruneInlineCompletionCache(this.cache);

    return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
  }
}
