import type { NoteSynthesisSetting } from '@storyboard/story-ai';
import type { ProjectSetting, StoryUri } from '@storyboard/story-format';

import type { ICardWriterRepository } from '#engine/application/cards/createCardUseCase';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import { applyCardCollectProposals } from '#engine/domain/cardCollect';
import type { NoteAbsorbPlan, NoteLeftOut } from '#engine/domain/notes/noteAbsorbPlan';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { NoteCardCandidate } from '#engine/shared/noteAbsorb';
import type { INoteAbsorbRepository } from './noteAbsorbRepository';

export interface ApplyNoteAbsorbRequest {
  readonly workspaceRoot: StoryUri;
  readonly plan: NoteAbsorbPlan;
  // Where the notes came from, kept with the candidates so `card promote` can say so.
  readonly location: string;
  // True only for a workspace `init` just made from the notes: then the contract's empty fields
  // are filled. Otherwise the contract is never touched and differences come back as proposals.
  readonly shouldFillContract: boolean;
}

export interface ApplyNoteAbsorbOutcome {
  readonly ok: true;
  readonly createdCards: readonly string[];
  readonly candidateCards: readonly string[];
  readonly createdScenes: readonly string[];
  readonly skippedScenes: readonly NoteLeftOut[];
  readonly synopsis: 'written' | 'candidate' | 'none';
  readonly filledSettingKeys: readonly string[];
  readonly settingProposals: NoteSynthesisSetting;
}

export type ApplyNoteAbsorbResult = ApplyNoteAbsorbOutcome | UseCaseFailure;

export interface ApplyNoteAbsorbUseCaseDependencies {
  readonly logger: IStoryboardLogger;
  readonly noteRepository: INoteAbsorbRepository;
  readonly cardWriter: ICardWriterRepository;
}

const settingKeys = ['genre', 'audience', 'concept', 'description', 'pov'] as const;

// Writes a plan: new cards and scenes go straight into the workspace, nothing that exists is
// overwritten — a card that exists gets candidates, a synopsis that exists gets a sibling file.
export class ApplyNoteAbsorbUseCase implements IUseCase<
  ApplyNoteAbsorbRequest,
  ApplyNoteAbsorbResult
> {
  public constructor(private readonly deps: ApplyNoteAbsorbUseCaseDependencies) {}

  public async execute(request: ApplyNoteAbsorbRequest): Promise<ApplyNoteAbsorbResult> {
    return await runUseCase(this.deps.logger, '노트 정리 결과를 반영하지 못했습니다.', async () => {
      const cards = await this.applyCards(request);
      const scenes = await this.applyScenes(request);
      const synopsis = await this.applySynopsis(request);
      const setting = await this.applySetting(request);

      return { ok: true as const, ...cards, ...scenes, synopsis, ...setting };
    });
  }

  private async applyCards(request: ApplyNoteAbsorbRequest): Promise<{
    readonly createdCards: string[];
    readonly candidateCards: string[];
  }> {
    const { workspaceRoot, plan, location } = request;
    const createdCards: string[] = [];
    const candidates: NoteCardCandidate[] = [];

    for (const entry of plan.cards) {
      const cardType = entry.card.type === 'character' ? 'character' : 'background';
      // A card written between planning and applying is the author's now; the notes only propose.
      const isStillNew =
        entry.isNew &&
        !(await this.deps.cardWriter.exists(workspaceRoot, entry.card.type, entry.card.id));

      if (isStillNew) {
        await this.deps.cardWriter.write(
          workspaceRoot,
          applyCardCollectProposals(entry.card, entry.changes),
        );
        createdCards.push(entry.card.id);
        continue;
      }

      if (entry.changes.length > 0) {
        candidates.push({
          cardId: entry.card.id,
          cardType,
          name: entry.card.name,
          sourceNotes: [...entry.sourceNotes],
          changes: [...entry.changes],
        });
      }
    }

    // Each absorb reads the notes whole, so its candidates replace the previous run's.
    await this.deps.noteRepository.saveCandidates(workspaceRoot, {
      location,
      absorbedAt: new Date().toISOString(),
      candidates,
    });

    return { createdCards, candidateCards: candidates.map((candidate) => candidate.cardId) };
  }

  private async applyScenes(request: ApplyNoteAbsorbRequest): Promise<{
    readonly createdScenes: string[];
    readonly skippedScenes: NoteLeftOut[];
  }> {
    const { workspaceRoot, plan } = request;
    const createdScenes: string[] = [];
    const skippedScenes: NoteLeftOut[] = [...plan.skippedScenes];

    for (const scene of plan.scenes) {
      if (await this.deps.noteRepository.sceneExists(workspaceRoot, scene.fileName)) {
        skippedScenes.push({
          label: scene.fileName,
          reason: '같은 이름의 씬 파일이 이미 있습니다',
        });
        continue;
      }

      await this.deps.noteRepository.writeScene(workspaceRoot, scene.fileName, scene.card);
      createdScenes.push(scene.fileName);
    }

    return { createdScenes, skippedScenes };
  }

  private async applySynopsis(
    request: ApplyNoteAbsorbRequest,
  ): Promise<'written' | 'candidate' | 'none'> {
    const { workspaceRoot, plan } = request;

    if (plan.synopsis === undefined) {
      return 'none';
    }

    const hasSynopsis = await this.deps.noteRepository.synopsisExists(workspaceRoot);
    await this.deps.noteRepository.writeSynopsis(workspaceRoot, plan.synopsis, hasSynopsis);

    return hasSynopsis ? 'candidate' : 'written';
  }

  private async applySetting(request: ApplyNoteAbsorbRequest): Promise<{
    readonly filledSettingKeys: string[];
    readonly settingProposals: NoteSynthesisSetting;
  }> {
    const { workspaceRoot, plan, shouldFillContract } = request;
    const project = await this.deps.noteRepository.loadProject(workspaceRoot);
    const current: Partial<ProjectSetting> = project.setting ?? {};
    const filled: Record<string, string> = {};
    const proposals: Record<string, string> = {};

    for (const key of settingKeys) {
      const proposed = plan.setting[key];

      if (proposed === undefined || current[key] === proposed) {
        continue;
      }

      // An explicit flag given to `init` is already in the contract, so it wins over the notes.
      if (shouldFillContract && current[key] === undefined) {
        filled[key] = proposed;
      } else {
        proposals[key] = proposed;
      }
    }

    if (Object.keys(filled).length > 0) {
      await this.deps.noteRepository.saveProject(workspaceRoot, {
        ...project,
        setting: {
          tags: [],
          prohibitions: [],
          styleConstraints: [],
          qualityCriteria: [],
          ...current,
          ...filled,
        },
      });
    }

    return {
      filledSettingKeys: Object.keys(filled),
      settingProposals: proposals as NoteSynthesisSetting,
    };
  }
}
