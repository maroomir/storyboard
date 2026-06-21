import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { isDraftMarkdownFile } from "../core/pathConventions"
import { hasStoryboardProject } from "../core/workspace"
import { parseDraft } from "../files/draft"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import { type AiProviderId, isCliProvider } from "../services/ai/types"
import type { UsageRecorder } from "../services/ai/UsageRecorder"

const inlineCompletionDelayMs = 700
const inlineCompletionPrefixChars = 1200
const inlineCompletionCacheLimit = 100

export interface RegisterInlineCompletionProviderDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

interface InlineCompletionCacheValue {
  readonly value: string
  readonly updatedAt: number
}

// NOTE: CLI provider는 호출마다 프로세스를 새로 띄워 키 입력당 인라인 완성에는 부적합하므로 건너뛴다.
export function shouldRunInlineCompletion(providerId: AiProviderId): boolean {
  return !isCliProvider(providerId)
}

export function trimInlineCompletionPrefix(text: string): string {
  if (text.length <= inlineCompletionPrefixChars) {
    return text
  }

  return text.slice(-inlineCompletionPrefixChars)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createInlineCompletionCacheKey(
  document: vscode.TextDocument,
  position: vscode.Position,
  prefix: string
): string {
  return `${document.uri.toString()}::${position.line}:${position.character}::${prefix}`
}

export function pruneInlineCompletionCache(cache: Map<string, InlineCompletionCacheValue>): void {
  if (cache.size <= inlineCompletionCacheLimit) {
    return
  }

  const sorted = [...cache.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  const removeCount = cache.size - inlineCompletionCacheLimit

  for (let index = 0; index < removeCount; index += 1) {
    const key = sorted[index]?.[0]
    if (key) {
      cache.delete(key)
    }
  }
}

class DraftInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new Map<string, InlineCompletionCacheValue>()
  private readonly aiService: StoryboardAIService
  private currentWorkspaceUri: vscode.Uri | undefined

  public constructor(private readonly dependencies: RegisterInlineCompletionProviderDependencies) {
    this.aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
      onUsage: (record): void => {
        if (this.currentWorkspaceUri) {
          recordUsageSafely(
            dependencies.usageRecorder,
            this.currentWorkspaceUri,
            record,
            dependencies.logger
          )
        }
      }
    })
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    if (document.uri.scheme !== "file") {
      return undefined
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      return undefined
    }
    this.currentWorkspaceUri = workspaceFolder.uri

    if (!isDraftMarkdownFile(document.uri, workspaceFolder)) {
      return undefined
    }

    if (!shouldRunInlineCompletion(this.dependencies.aiProviderRegistry.getTaskProvider("inlineCompletion"))) {
      return undefined
    }

    const fullPrefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position))
    const prefix = trimInlineCompletionPrefix(fullPrefix).trim()
    if (prefix.length === 0) {
      return undefined
    }

    const cacheKey = createInlineCompletionCacheKey(document, position, prefix)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return [new vscode.InlineCompletionItem(cached.value, new vscode.Range(position, position))]
    }

    await sleep(inlineCompletionDelayMs)
    if (token.isCancellationRequested) {
      return undefined
    }

    let sceneStem = "unknown-scene"
    try {
      sceneStem = parseDraft(document.getText()).sceneStem
    } catch {
      const fileName = document.uri.path.split("/").pop() ?? ""
      sceneStem = fileName.replace(/\.md$/i, "")
    }

    const completion = await this.aiService.completeInline(
      prefix,
      {},
      {
        providerId: this.dependencies.aiProviderRegistry.getTaskProvider("inlineCompletion"),
        attribution: { primary: { kind: "scene", id: sceneStem } }
      }
    )

    if (token.isCancellationRequested || completion.trim().length === 0) {
      return undefined
    }

    this.cache.set(cacheKey, { value: completion, updatedAt: Date.now() })
    pruneInlineCompletionCache(this.cache)

    return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))]
  }
}

export function registerInlineCompletionProvider(
  dependencies: RegisterInlineCompletionProviderDependencies
): vscode.Disposable {
  const selector: vscode.DocumentSelector = { scheme: "file", pattern: "**/draft/*.md" }
  return vscode.languages.registerInlineCompletionItemProvider(
    selector,
    new DraftInlineCompletionProvider(dependencies)
  )
}
