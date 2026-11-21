import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import {
  applyProofreadEdits,
  splitIntoProofreadChunks,
  type ProofreadLimits,
} from '#engine/pipeline/proofreadEdits';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import {
  AiProviderError,
  characterMatchTokens,
  findBrokenGlyphSpans,
  type BrokenHangulSpan,
  type ProofreadEdit,
} from '@storyboard/story-model';

export class ProofreadDraftStage implements ISceneStage {
  public readonly id: SceneStageId = 'proofreadDraft';

  public async run(run: SceneGenerationRun): Promise<void> {
    const allowedText: string = this.collectAllowedText(run);
    const chunks: string[] = splitIntoProofreadChunks(
      run.draftBody,
      run.tuning.proofreadChunkLength,
    );
    const options: GenerateTextOptions = withAttribution(
      buildGenerateOptions(run.providers, 'sceneProofread'),
      { primary: run.sceneRef },
    );
    const corrected: string[] = [];

    for (const [index, chunk] of chunks.entries()) {
      assertNotCancelled(run.shouldCancel);
      run.onProgress?.('proofreadDraft', index + 1, chunks.length);
      corrected.push(await this.proofreadChunk(run, chunk, { allowedText, options }));
    }

    run.draftBody = corrected.join('');
    this.warnAboutRemainingGlyphs(run, allowedText);
  }

  private async proofreadChunk(
    run: SceneGenerationRun,
    chunk: string,
    context: { readonly allowedText: string; readonly options: GenerateTextOptions },
  ): Promise<string> {
    const suspects: BrokenHangulSpan[] = findBrokenGlyphSpans(chunk, context.allowedText);
    let edits: ProofreadEdit[];

    try {
      edits = await run.aiService.proofreadSceneText(
        { text: chunk, suspects: suspects.map((span) => span.excerpt) },
        context.options,
      );
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw error;
      }

      run.warnings.push({ message: `교정: 한 조각을 교정하지 못했습니다 (${error.message})` });
      return chunk;
    }

    const limits: ProofreadLimits = {
      maxEditLength: run.tuning.proofreadMaxEditLength,
      maxEditDistance: run.tuning.proofreadMaxEditDistance,
    };
    return applyProofreadEdits(chunk, edits, { allowedText: context.allowedText, limits }).text;
  }

  private collectAllowedText(run: SceneGenerationRun): string {
    const cardNames: string[] = run.context.characters.flatMap((card) =>
      characterMatchTokens(card),
    );

    return [run.skeleton, run.background.name, ...cardNames].join('\n');
  }

  private warnAboutRemainingGlyphs(run: SceneGenerationRun, allowedText: string): void {
    const remaining: BrokenHangulSpan[] = findBrokenGlyphSpans(run.draftBody, allowedText);
    if (remaining.length === 0) {
      return;
    }

    run.warnings.push({
      message: `교정 뒤에도 깨진 글자 ${remaining.length}곳이 남았습니다: ${remaining.map((span) => `"${span.excerpt}"`).join(', ')}`,
      kinds: ['broken-hangul'],
    });
  }
}
