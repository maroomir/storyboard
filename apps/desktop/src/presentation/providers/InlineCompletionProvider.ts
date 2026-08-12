import * as vscode from 'vscode';

import type { AiGateway } from '../../application/ai/aiGateway';
import {
  getStoryboardProjectPaths,
  isDraftMarkdownFile,
  sceneFilePath,
} from '../../infrastructure/vscode/pathConventions';
import { parseDraft } from '@seedkernel/wasm';
import { readSceneFile } from '@/domain/files/storyFiles';
import { buildSceneContext } from '@/domain/sceneContext';
import type { BackgroundCard, CharacterCard } from '@seedkernel/wasm';
import {
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../../infrastructure/vscode/workspaceFsAdapters';
import { hasStoryboardProject } from '../../infrastructure/vscode/workspace';
import { isCliProvider } from '@storyboard/story-ai';
import type { AiProviderId, InlineCompletionContext } from '@storyboard/story-ai';
import { parseDraftSceneParts } from '../../infrastructure/vscode/draftSceneLink';

const inlineCompletionDelayMs = 700;
const inlineCompletionPrefixChars = 1200;
const inlineCompletionCacheLimit = 100;
const inlineSceneContextTtlMs = 60_000;
const inlineSceneIntentChars = 300;
const inlineMaxActiveCharacters = 3;

export interface RegisterInlineCompletionProviderDependencies {
  readonly aiGateway: AiGateway;
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
  const labels = characters.slice(0, inlineMaxActiveCharacters).map((character) => {
    const voice = character.voice?.[0]?.trim();
    return voice ? `${character.name}(${voice})` : character.name;
  });

  return labels.length > 0 ? labels.join(', ') : undefined;
}

function formatSceneBackground(background: BackgroundCard | undefined): string | undefined {
  if (!background) {
    return undefined;
  }

  const description = background.description[0]?.trim();
  return description ? `${background.name} — ${description}` : background.name;
}

function formatSceneIntent(sceneBody: string): string | undefined {
  const trimmed = sceneBody.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.length <= inlineSceneIntentChars
    ? trimmed
    : trimmed.slice(0, inlineSceneIntentChars).trim();
}

// NOTE: CLI provider는 호출마다 프로세스를 새로 띄워 키 입력당 인라인 완성에는 부적합하므로 건너뛴다.
export function shouldRunInlineCompletion(providerId: AiProviderId): boolean {
  return !isCliProvider(providerId);
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

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
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

  const sorted = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const removeCount = cache.size - inlineCompletionCacheLimit;

  for (let index = 0; index < removeCount; index += 1) {
    const key = sorted[index]?.[0];
    if (key) {
      cache.delete(key);
    }
  }
}

class DraftInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new Map<string, InlineCompletionCacheValue>();
  private readonly sceneContextCache = new Map<string, CachedSceneContext>();

  public constructor(private readonly dependencies: RegisterInlineCompletionProviderDependencies) {}

  private canCompleteDraft(
    documentUri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
  ): boolean {
    return (
      isDraftMarkdownFile(documentUri, workspaceFolder) &&
      shouldRunInlineCompletion(this.dependencies.aiGateway.getTaskProvider('inlineCompletion'))
    );
  }

  private async loadSceneContext(
    document: vscode.TextDocument,
    workspaceFolder: vscode.WorkspaceFolder,
    sceneStem: string,
  ): Promise<InlineCompletionContext> {
    const cached = this.sceneContextCache.get(sceneStem);
    if (cached && Date.now() - cached.cachedAt < inlineSceneContextTtlMs) {
      return cached.context;
    }

    const context = await this.readSceneContext(document, workspaceFolder);
    this.sceneContextCache.set(sceneStem, { context, cachedAt: Date.now() });
    return context;
  }

  private async readSceneContext(
    document: vscode.TextDocument,
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<InlineCompletionContext> {
    const parts = parseDraftSceneParts(document.getText());
    if (!parts) {
      return {};
    }

    try {
      const sceneUri = sceneFilePath(workspaceFolder.uri, parts.orderText, parts.slug);
      const fileName = sceneUri.path.split('/').pop() ?? '';
      const scene = await readSceneFile(sceneUri, vscodeFsAdapter, fileName);

      const paths = sceneContextPaths(getStoryboardProjectPaths(workspaceFolder.uri));
      const sceneContext = await buildSceneContext(paths, scene, sceneContextFileSystem);

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
    const workspaceFolder = await resolveStoryboardWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }
    if (!this.canCompleteDraft(document.uri, workspaceFolder)) {
      return undefined;
    }

    const fullPrefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const prefix = trimInlineCompletionPrefix(fullPrefix).trim();
    if (prefix.length === 0) {
      return undefined;
    }

    const cacheKey = createInlineCompletionCacheKey(document, position, prefix);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return [new vscode.InlineCompletionItem(cached.value, new vscode.Range(position, position))];
    }

    await sleep(inlineCompletionDelayMs);
    if (token.isCancellationRequested) {
      return undefined;
    }

    let sceneStem = 'unknown-scene';
    try {
      sceneStem = parseDraft(document.getText()).sceneStem;
    } catch {
      const fileName = document.uri.path.split('/').pop() ?? '';
      sceneStem = fileName.replace(/\.md$/i, '');
    }

    const sceneContext = await this.loadSceneContext(document, workspaceFolder, sceneStem);
    if (token.isCancellationRequested) {
      return undefined;
    }

    const completion = await this.dependencies.aiGateway
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

export function registerInlineCompletionProvider(
  dependencies: RegisterInlineCompletionProviderDependencies,
): vscode.Disposable {
  const selector: vscode.DocumentSelector = { scheme: 'file', pattern: '**/draft/*.md' };
  return vscode.languages.registerInlineCompletionItemProvider(
    selector,
    new DraftInlineCompletionProvider(dependencies),
  );
}
