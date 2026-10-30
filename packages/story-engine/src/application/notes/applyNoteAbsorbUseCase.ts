import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type {
  ProjectSetting,
  StoryUri,
  NoteSynthesisSetting,
  NoteAbsorbPlan,
  SkippedNote,
  NoteCardCandidate,
NoteCandidateFile,
StoryboardProject,
BibleFact,
BibleSubjectKind,
} from '@storyboard/story-model';

import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  addNoteCandidateSource,
  applyCardCollectProposals,
  buildCandidateFact,
  emptyNoteCandidateFile,
  mergeNoteCandidateSources,
  mergeNoteSynopsisCandidate,
  serializeSynopsisMarkdown,
} from '@storyboard/story-model';
import type { NoteCandidateLoad } from '#engine/application/notes/noteAbsorbRepository';

export interface ApplyNoteAbsorbRequest {
  readonly workspaceRoot: StoryUri;
  readonly plan: NoteAbsorbPlan;
  readonly location: string;
  readonly shouldFillContract: boolean;
  readonly shouldReplaceCandidates: boolean;
}

export interface ApplyNoteAbsorbOutcome {
  readonly ok: true;
  readonly createdCards: readonly string[];
  readonly candidateCards: readonly string[];
  readonly pendingCandidateCards: readonly string[];
  readonly createdScenes: readonly string[];
  readonly skippedScenes: readonly SkippedNote[];
  readonly synopsis: 'written' | 'candidate' | 'none';
  readonly filledSettingKeys: readonly string[];
  readonly settingProposals: NoteSynthesisSetting;
  readonly seededCharacters: readonly string[];
  readonly canonCandidates: number;
}

export type ApplyNoteAbsorbResult = ApplyNoteAbsorbOutcome | UseCaseFailure;

type FillableSettingKey = 'genre' | 'audience' | 'concept' | 'description' | 'pov';

const settingKeys: readonly FillableSettingKey[] = ['genre', 'audience', 'concept', 'description', 'pov'];

export interface AppliedNoteSetting {
  readonly filledSettingKeys: string[];
  readonly settingProposals: NoteSynthesisSetting;
}

export interface AppliedNoteScenes {
  readonly createdScenes: string[];
  readonly skippedScenes: SkippedNote[];
}

export interface AppliedNoteCards {
  readonly createdCards: string[];
  readonly candidateCards: string[];
  readonly pendingCandidateCards: string[];
}

export class ApplyNoteAbsorbUseCase implements IUseCase<
  ApplyNoteAbsorbRequest,
  ApplyNoteAbsorbResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: ApplyNoteAbsorbRequest): Promise<ApplyNoteAbsorbResult> {
    return await runUseCase(this.host.logger, '노트 정리 결과를 반영하지 못했습니다.', async () => {
      const cards: AppliedNoteCards = await this.applyCards(request);
      const scenes: AppliedNoteScenes = await this.applyScenes(request);
      const synopsis: 'written' | 'candidate' | 'none' = await this.applySynopsis(request);
      const setting: AppliedNoteSetting = await this.applySetting(request);
      const seededCharacters: string[] = Object.keys(request.plan.voiceSeeds);
      if (seededCharacters.length > 0) {
        await this.repositories.noteAbsorb.addVoiceSeeds(request.workspaceRoot, request.plan.voiceSeeds);
      }
      const canonCandidates: number = await this.applyCanonCandidates(request);

      return {
        ok: true as const,
        ...cards,
        ...scenes,
        synopsis,
        ...setting,
        seededCharacters,
        canonCandidates,
      };
    });
  }

  private async applyCanonCandidates(request: ApplyNoteAbsorbRequest): Promise<number> {
    const facts: BibleFact[] = request.plan.canonCandidates.map((candidate) =>
      buildCandidateFact(candidate.subject, candidate.key, candidate.value),
    );
    await this.repositories.noteAbsorb.saveCanonCandidates(
      request.workspaceRoot,
      request.location,
      facts,
    );

    return facts.length;
  }

  private async applyCards(request: ApplyNoteAbsorbRequest): Promise<AppliedNoteCards> {
    const { workspaceRoot, plan, location, shouldReplaceCandidates } = request;
    const loaded: NoteCandidateLoad = await this.repositories.noteAbsorb.loadCandidates(workspaceRoot);

    if (loaded.kind === 'legacy') {
      this.host.logger.warn(
        '이전 버전이 남긴 카드 후보(.storyboard/cache/notes/candidates.json)는 읽지 않고 이번 후보로 바꿉니다. 필요하면 그 노트를 다시 흡수하세요.',
      );
    }

    const createdCards: string[] = [];
    const candidates: NoteCardCandidate[] = [];

    for (const entry of plan.cards) {
      const cardType: BibleSubjectKind = entry.card.type === 'character' ? 'character' : 'background';
      const isStillNew: boolean =
        entry.isNew &&
        !(await this.repositories.cardWriter.exists(workspaceRoot, entry.card.type, entry.card.id));

      if (isStillNew) {
        await this.repositories.cardWriter.write(
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

    const file: NoteCandidateFile = addNoteCandidateSource(
      loaded.kind === 'current' ? loaded.file : emptyNoteCandidateFile,
      { location, absorbedAt: new Date().toISOString(), candidates },
      shouldReplaceCandidates,
    );
    await this.repositories.noteAbsorb.saveCandidates(workspaceRoot, file);

    return {
      createdCards,
      candidateCards: candidates.map((candidate) => candidate.cardId),
      pendingCandidateCards: mergeNoteCandidateSources(file.sources).map((card) => card.cardId),
    };
  }

  private async applyScenes(request: ApplyNoteAbsorbRequest): Promise<AppliedNoteScenes> {
    const { workspaceRoot, plan } = request;
    const createdScenes: string[] = [];
    const skippedScenes: SkippedNote[] = [...plan.skippedScenes];

    for (const scene of plan.scenes) {
      if (await this.repositories.noteAbsorb.sceneExists(workspaceRoot, scene.fileName)) {
        skippedScenes.push({
          label: scene.fileName,
          reason: '같은 이름의 씬 파일이 이미 있습니다',
        });
        continue;
      }

      await this.repositories.noteAbsorb.writeScene(workspaceRoot, scene.fileName, scene.card);
      createdScenes.push(scene.fileName);
    }

    return { createdScenes, skippedScenes };
  }

  private async applySynopsis(
    request: ApplyNoteAbsorbRequest,
  ): Promise<'written' | 'candidate' | 'none'> {
    const { workspaceRoot, plan, location, shouldReplaceCandidates } = request;
    const { noteAbsorb: noteRepository } = this.repositories;
    const isCandidate: boolean =
      plan.synopsis !== undefined && (await noteRepository.synopsisExists(workspaceRoot));

    if (plan.synopsis !== undefined && !isCandidate) {
      await noteRepository.writeSynopsis(workspaceRoot, plan.synopsis);
    }

    const existing: string | undefined = await noteRepository.loadSynopsisCandidate(workspaceRoot);

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

  private async applySetting(request: ApplyNoteAbsorbRequest): Promise<AppliedNoteSetting> {
    const { workspaceRoot, plan, shouldFillContract } = request;
    const project: StoryboardProject = await this.repositories.noteAbsorb.loadProject(workspaceRoot);
    const current: Partial<ProjectSetting> = project.setting ?? {};
    const filled: Record<string, string> = {};
    const proposals: Record<string, string> = {};

    for (const key of settingKeys) {
      const proposed: string | undefined = plan.setting[key];

      if (proposed === undefined || current[key] === proposed) {
        continue;
      }

      if (shouldFillContract && current[key] === undefined) {
        filled[key] = proposed;
      } else {
        proposals[key] = proposed;
      }
    }

    if (Object.keys(filled).length > 0) {
      await this.repositories.noteAbsorb.saveProject(workspaceRoot, {
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
