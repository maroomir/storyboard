import type {
  ProjectSetting,
  StoryUri,
  NoteSynthesisSetting,
  NoteAbsorbPlan,
  NoteLeftOut,
  NoteCardCandidate,
} from '@storyboard/story-model';

import type { ICardWriterRepository } from '#engine/application/cards/createCardUseCase';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  addNoteCandidateSource,
  applyCardCollectProposals,
  emptyNoteCandidateFile,
  mergeNoteCandidateSources,
  mergeNoteSynopsisCandidate,
  serializeSynopsisMarkdown,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { INoteAbsorbRepository } from './noteAbsorbRepository';

export interface ApplyNoteAbsorbRequest {
  readonly workspaceRoot: StoryUri;
  readonly plan: NoteAbsorbPlan;
  // Where the notes came from, kept with the candidates so `card promote` can say so.
  readonly location: string;
  // True only for a workspace `init` just made from the notes: then the contract's empty fields
  // are filled. Otherwise the contract is never touched and differences come back as proposals.
  readonly shouldFillContract: boolean;
  // Drops every candidate earlier absorbs left instead of adding to them.
  readonly shouldReplaceCandidates: boolean;
}

export interface ApplyNoteAbsorbOutcome {
  readonly ok: true;
  readonly createdCards: readonly string[];
  readonly candidateCards: readonly string[];
  // Cards with candidates waiting for `card promote`, this absorb's included.
  readonly pendingCandidateCards: readonly string[];
  readonly createdScenes: readonly string[];
  readonly skippedScenes: readonly NoteLeftOut[];
  readonly synopsis: 'written' | 'candidate' | 'none';
  readonly filledSettingKeys: readonly string[];
  readonly settingProposals: NoteSynthesisSetting;
  // Characters whose quoted lines from the notes became voice samples.
  readonly seededCharacters: readonly string[];
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
      const seededCharacters = Object.keys(request.plan.voiceSeeds);
      if (seededCharacters.length > 0) {
        await this.deps.noteRepository.addVoiceSeeds(request.workspaceRoot, request.plan.voiceSeeds);
      }

      return { ok: true as const, ...cards, ...scenes, synopsis, ...setting, seededCharacters };
    });
  }

  private async applyCards(request: ApplyNoteAbsorbRequest): Promise<{
    readonly createdCards: string[];
    readonly candidateCards: string[];
    readonly pendingCandidateCards: string[];
  }> {
    const { workspaceRoot, plan, location, shouldReplaceCandidates } = request;
    // Read before any card is written, so a file that cannot be read leaves the workspace as it was.
    const loaded = await this.deps.noteRepository.loadCandidates(workspaceRoot);

    if (loaded.kind === 'legacy') {
      this.deps.logger.warn(
        '이전 버전이 남긴 카드 후보(.storyboard/cache/notes/candidates.json)는 읽지 않고 이번 후보로 바꿉니다. 필요하면 그 노트를 다시 흡수하세요.',
      );
    }

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

    const file = addNoteCandidateSource(
      loaded.kind === 'current' ? loaded.file : emptyNoteCandidateFile,
      { location, absorbedAt: new Date().toISOString(), candidates },
      shouldReplaceCandidates,
    );
    await this.deps.noteRepository.saveCandidates(workspaceRoot, file);

    return {
      createdCards,
      candidateCards: candidates.map((candidate) => candidate.cardId),
      pendingCandidateCards: mergeNoteCandidateSources(file.sources).map((card) => card.cardId),
    };
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
    const { workspaceRoot, plan, location, shouldReplaceCandidates } = request;
    const { noteRepository } = this.deps;
    const isCandidate =
      plan.synopsis !== undefined && (await noteRepository.synopsisExists(workspaceRoot));

    if (plan.synopsis !== undefined && !isCandidate) {
      await noteRepository.writeSynopsis(workspaceRoot, plan.synopsis);
    }

    const existing = await noteRepository.loadSynopsisCandidate(workspaceRoot);

    if (existing !== undefined || isCandidate) {
      await noteRepository.saveSynopsisCandidate(
        workspaceRoot,
        mergeNoteSynopsisCandidate(
          shouldReplaceCandidates ? undefined : existing,
          location,
          isCandidate && plan.synopsis !== undefined
            ? serializeSynopsisMarkdown(plan.synopsis)
            : undefined,
        ),
      );
    }

    if (plan.synopsis === undefined) {
      return 'none';
    }

    return isCandidate ? 'candidate' : 'written';
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
