import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  STORYBOARD_RELATIVE_PATHS,
  applySceneGrounding,
  buildNarrativeContext,
  buildSceneContext,
  createDraft,
  extractDraftBody,
  formatBibleFactLines,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  serializeDraft,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths,
  type SceneFile,
} from '@storyboard/story-format';
import { buildStyleDirective, formatAugmentCards } from '@storyboard/story-ai';
import type {
  AiProviderRegistry,
  StoryboardAIService,
  UsageAttribution,
} from '@storyboard/story-ai';
import {
  resolveSceneTargetLength,
  runReviseLoop,
  runSceneGenerationPipeline,
} from '@storyboard/story-pipeline';

import type { DraftConfig } from '../config/config';
import type { ContentService } from '../content/contentService';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import { createBackgroundMemoryStore, createPersonaMemoryStore } from './cardMemoryStores';
import type { DraftGenerator } from './draftPipeline';
import type { DraftReviser, DraftRevisionReport } from './reviewPipeline';

// The scene-context helpers take opaque `unknown` locations so the extension can pass vscode.Uri.
// Headless, the location is simply an absolute path string.
function createPaths(root: string): SceneContextWorkspacePaths {
  const at = (relative: string): string => join(root, ...relative.split('/'));

  return {
    characterDirectory: at(STORYBOARD_RELATIVE_PATHS.characterDirectory),
    backgroundDirectory: at(STORYBOARD_RELATIVE_PATHS.backgroundDirectory),
    draftDirectory: at(STORYBOARD_RELATIVE_PATHS.draftDirectory),
    bibleCanon: at(STORYBOARD_RELATIVE_PATHS.bibleCanon),
    manuscriptSummary: join(at(STORYBOARD_RELATIVE_PATHS.manuscriptDirectory), 'SUMMARY.md'),
    joinPath: (base, ...segments) => join(String(base), ...segments),
  };
}

function createFileSystem(): SceneContextWorkspaceFileSystem {
  return {
    readFile: async (uri) => new Uint8Array(await readFile(String(uri))),
    writeFile: () => {
      // Context building is read-only; writes go through the mutate gate, never here.
      throw new Error('scene context must not write');
    },
    readDirectory: async (uri) => {
      const entries = await readdir(String(uri), { withFileTypes: true });
      return entries.map((entry): [string, { type: 'file' | 'directory' }] => [
        entry.name,
        { type: entry.isDirectory() ? 'directory' : 'file' },
      ]);
    },
  };
}

export interface SceneDraftGeneratorOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly aiService: StoryboardAIService;
  readonly registry: AiProviderRegistry;
  readonly draftConfig: DraftConfig;
  readonly generator: string;
  readonly onStage?: (stage: string, current: number, total: number) => void;
}

// Runs the very same staged pipeline the extension runs, assembled from the workspace on disk, and
// finishes with the shared review→revise loop (decision #31) before the body is written.
export class SceneDraftGenerator implements DraftGenerator, DraftReviser {
  public constructor(private readonly options: SceneDraftGeneratorOptions) {}

  public async generate(sceneStem: string, isCancelled: () => boolean): Promise<string> {
    const { store, content, aiService } = this.options;
    const assembled = await this.assembleSceneContext(sceneStem);

    const result = await runSceneGenerationPipeline({
      context: assembled.context,
      aiService,
      format: assembled.format,
      sceneStem,
      styleDirective: assembled.styleDirective,
      previousContext: assembled.narrative.prompt,
      personaStore: createPersonaMemoryStore(store, content, sceneStem),
      backgroundStore: createBackgroundMemoryStore(store, content, sceneStem),
      shouldCancel: isCancelled,
      onProgress: (stage, current, total) => this.options.onStage?.(stage, current, total),
    });

    if (!this.options.draftConfig.reviseAfterGenerate || isCancelled()) {
      return this.serializeWithProvenance(sceneStem, assembled, result.draftBody, 'sceneDraft');
    }

    const revised = await this.runSharedReviseLoop(
      sceneStem,
      result.draftBody,
      assembled,
      isCancelled,
    );
    return this.serializeWithProvenance(
      sceneStem,
      assembled,
      revised.body,
      revised.revisionCount > 0 ? 'draftRevision' : 'sceneDraft',
    );
  }

  // The /review command: runs the same review→revise loop over the draft that already exists,
  // without regenerating it (UC-06).
  public async revise(
    sceneStem: string,
    draftText: string,
    isCancelled: () => boolean,
  ): Promise<DraftRevisionReport> {
    const assembled = await this.assembleSceneContext(sceneStem);
    const draftBody = extractDraftBody(draftText);
    const revised = await this.runSharedReviseLoop(sceneStem, draftBody, assembled, isCancelled);

    return {
      // An unrevised draft returns the original text unchanged so the caller skips the write.
      body:
        revised.body === draftBody
          ? draftText
          : this.serializeWithProvenance(sceneStem, assembled, revised.body, 'draftRevision'),
      passed: revised.passed,
      revisionCount: revised.revisionCount,
      remainingBlocking: revised.remainingBlocking,
      cancelled: revised.cancelled,
    };
  }

  private serializeWithProvenance(
    sceneStem: string,
    assembled: AssembledSceneContext,
    body: string,
    taskName: 'sceneDraft' | 'draftRevision',
  ): string {
    const { providerId, model } = this.options.registry.getTaskAiConfig(taskName);

    return serializeDraft(
      createDraft({
        sceneStem,
        format: assembled.format,
        body,
        generator: this.options.generator,
        providerId,
        model,
      }),
    );
  }

  private async assembleSceneContext(sceneStem: string): Promise<AssembledSceneContext> {
    const { store } = this.options;
    const scene = await store.readScene(sceneStem);
    const project = await store.readProject();

    const paths = createPaths(store.root);
    const fileSystem = createFileSystem();
    const builtContext = await buildSceneContext(paths, scene.value, fileSystem);

    // The extension resolves grounding the same way and for the same reason: the facts must be
    // settled before the dialogue prompt runs, and the proposal needs resolved card names.
    const groundedScene = await resolveGrounding(
      sceneStem,
      scene,
      builtContext.characters.map((character) => character.name),
      this.options,
    );
    const context = { ...builtContext, scene: groundedScene };
    const narrative = await buildNarrativeContext(paths, context, fileSystem);

    return {
      scene: groundedScene,
      project: project.value,
      context,
      narrative,
      format: project.value.format ?? 'novel',
      styleDirective: buildStyleDirective(
        project.value.setting,
        groundedScene.frontmatter.relationStage,
        groundedScene.frontmatter.targetWordCount,
        groundedScene.body,
      ),
    };
  }

  private runSharedReviseLoop(
    sceneStem: string,
    body: string,
    assembled: AssembledSceneContext,
    isCancelled: () => boolean,
  ): ReturnType<typeof runReviseLoop> {
    const { aiService, registry } = this.options;
    const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };

    return runReviseLoop({
      aiService,
      registry,
      attribution,
      ctx: {
        format: assembled.format,
        intent: assembled.scene.body,
        factLines: formatBibleFactLines(assembled.context, assembled.narrative.bibleFacts),
        characterNames: assembled.context.characters.map((character) => character.name),
        characterCards: formatAugmentCards(assembled.context.characters, undefined),
        styleConstraints: assembled.project.setting?.styleConstraints ?? [],
        qualityCriteria: assembled.project.setting?.qualityCriteria ?? [],
        styleDirective: assembled.styleDirective,
        characters: assembled.context.characters,
        targetLength: resolveSceneTargetLength(
          assembled.scene.frontmatter.targetWordCount,
          assembled.scene.body,
        ),
      },
      body,
      maxIterations: this.options.draftConfig.reviseMaxIterations,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50,
      shouldCancel: isCancelled,
      onProgress: (message) => this.options.onStage?.(message, 0, 0),
    });
  }
}

// Fills the empty grounding fields and commits them to the scene frontmatter. `scene/` is tracked,
// so this write is a commit like every other authored change — never a silent edit.
async function resolveGrounding(
  sceneStem: string,
  scene: Awaited<ReturnType<WorkspaceStore['readScene']>>,
  characterNames: readonly string[],
  options: SceneDraftGeneratorOptions,
): Promise<SceneFile> {
  const missingFields = missingSceneGroundingFields(scene.value.frontmatter.grounding);

  if (!options.draftConfig.autoGrounding || missingFields.length === 0) {
    return scene.value;
  }

  const proposed = await options.aiService.proposeSceneGrounding(
    {
      sceneBody: scene.value.body,
      missingFields,
      characterNames,
      knownGrounding: scene.value.frontmatter.grounding,
    },
    { attribution: { primary: { kind: 'scene', id: sceneStem } } },
  );
  const merged = mergeSceneGrounding(scene.value.frontmatter.grounding, proposed);

  if (Object.keys(merged).length === 0) {
    return scene.value;
  }

  const raw = await options.store.readText(scene.relativePath);
  const outcome = await options.content.writeTracked(
    scene.relativePath,
    applySceneGrounding(raw, merged),
    scene.contentHash,
    `storygram: ground ${scene.relativePath}`,
  );

  // A stale or blocked write means Desktop touched the scene mid-job. The facts still steer this
  // generation; the next run re-proposes against whatever landed on disk.
  if (outcome.status !== 'committed' && outcome.status !== 'written') {
    options.onStage?.('사실 시트 저장 건너뜀 (동시 편집 감지)', 0, 0);
  }

  return {
    ...scene.value,
    card: { ...scene.value.card, grounding: merged },
    frontmatter: { ...scene.value.frontmatter, grounding: merged },
  };
}

interface AssembledSceneContext {
  readonly scene: Awaited<ReturnType<WorkspaceStore['readScene']>>['value'];
  readonly project: Awaited<ReturnType<WorkspaceStore['readProject']>>['value'];
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
  readonly narrative: Awaited<ReturnType<typeof buildNarrativeContext>>;
  readonly format: NonNullable<
    Awaited<ReturnType<WorkspaceStore['readProject']>>['value']['format']
  >;
  readonly styleDirective: ReturnType<typeof buildStyleDirective>;
}
