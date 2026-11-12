import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type {
  ProjectSetting,
  StoryUri,
  NoteSynthesisSetting,
  NoteAbsorbPlan,
  SkippedNote,
  NoteCardFact,
  NoteCardPlan,
  NoteSourceKind,
  Statement,
  StatementSource,
  StoryboardProject,
  StoryboardCard,
} from '@storyboard/story-model';

import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  applyCardCollectProposals,
  describeNoteSource,
  mergeStatements,
} from '@storyboard/story-model';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { PlannedCardChanges } from '#engine/persistence/bundles/workspaceCards';

export function toFactStatements(
  facts: readonly NoteCardFact[],
  source: StatementSource,
): Statement[] {
  return facts.map((fact) => ({ facet: 'fact', key: fact.key, value: fact.value, source }));
}

export interface ApplyNoteAbsorbRequest {
  readonly workspaceRoot: StoryUri;
  readonly plan: NoteAbsorbPlan;
  readonly location: string;
  readonly sourceKind: NoteSourceKind;
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
        await this.repositories.noteAbsorb.addVoiceSeeds(
          request.workspaceRoot,
          request.sourceKind,
          request.plan.voiceSeeds,
        );
      }

      return {
        ok: true as const,
        ...cards,
        ...scenes,
        synopsis,
        ...setting,
        seededCharacters,
      };
    });
  }

  private async applyCards(request: ApplyNoteAbsorbRequest): Promise<AppliedNoteCards> {
    const { workspaceRoot, plan, location, shouldReplaceCandidates } = request;
    const { noteAbsorb } = this.repositories;
    await noteAbsorb.clearCardPending(workspaceRoot, shouldReplaceCandidates ? undefined : location);

    const createdCards: string[] = [];
    const newCards: StoryboardCard[] = [];
    const existingEntries: NoteCardPlan[] = [];
    for (const entry of plan.cards) {
      const isStillNew: boolean =
        entry.isNew &&
        !(await this.repositories.cardWriter.exists(workspaceRoot, entry.card.type, entry.card.id));
      if (isStillNew) {
        newCards.push(applyCardCollectProposals(entry.card, entry.changes));
        createdCards.push(entry.card.id);
      } else if (entry.changes.length > 0 || entry.facts.length > 0) {
        existingEntries.push(entry);
      }
    }

    await this.repositories.cardWriter.writeAll(workspaceRoot, newCards);
    await this.writeNewCardFacts(request, plan.cards.filter((entry) => createdCards.includes(entry.card.id)));
    const candidateCards: string[] = await this.leaveExistingCardPending(request, existingEntries);

    return {
      createdCards,
      candidateCards,
      pendingCandidateCards: [...(await noteAbsorb.listCardsWithPending(workspaceRoot))],
    };
  }

  private async writeNewCardFacts(
    request: ApplyNoteAbsorbRequest,
    entries: readonly NoteCardPlan[],
  ): Promise<void> {
    for (const entry of entries.filter((item) => item.facts.length > 0)) {
      const source: StatementSource = this.absorbSource(request, entry);
      const bundle: ElementBundle | undefined = await this.host.cards.findBundleBySlug(
        request.workspaceRoot,
        entry.card.id,
      );
      if (bundle !== undefined) {
        await this.host.cards.rewriteBundle(request.workspaceRoot, bundle, {
          header: bundle.header,
          statements: mergeStatements(bundle.statements, toFactStatements(entry.facts, source))
            .statements,
        });
      }
    }
  }

  private async leaveExistingCardPending(
    request: ApplyNoteAbsorbRequest,
    entries: readonly NoteCardPlan[],
  ): Promise<string[]> {
    const { workspaceRoot, location } = request;
    const candidateCards: string[] = [];

    for (const entry of entries) {
      const source: StatementSource = this.absorbSource(request, entry);
      const current: StoryboardCard | undefined = await this.host.cards.findCard(
        workspaceRoot,
        entry.card.id,
      );
      const changed: PlannedCardChanges =
        current === undefined
          ? { statements: [] }
          : await this.host.cards.planCardChanges(
              workspaceRoot,
              applyCardCollectProposals(current, entry.changes),
              source,
            );
      const statements: readonly Statement[] = [
        ...changed.statements,
        ...toFactStatements(entry.facts, source),
      ];
      if (statements.length > 0 || changed.header !== undefined) {
        await this.repositories.noteAbsorb.saveCardPending(
          workspaceRoot,
          location,
          entry.card.id,
          statements,
          changed.header,
        );
        candidateCards.push(entry.card.id);
      }
    }

    return candidateCards;
  }

  private absorbSource(request: ApplyNoteAbsorbRequest, entry: NoteCardPlan): StatementSource {
    return {
      origin: 'studio',
      command: 'notes absorb',
      session: describeNoteSource(request.sourceKind, entry.sourceNotes[0]),
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
    if (shouldReplaceCandidates) {
      await noteRepository.clearSynopsisCandidates(workspaceRoot);
    }
    if (plan.synopsis === undefined) {
      await noteRepository.saveSynopsisCandidate(workspaceRoot, location, undefined);
      return 'none';
    }

    const isCandidate: boolean = await noteRepository.synopsisExists(workspaceRoot);
    if (isCandidate) {
      await noteRepository.saveSynopsisCandidate(workspaceRoot, location, plan.synopsis);
      return 'candidate';
    }

    await noteRepository.writeSynopsis(workspaceRoot, plan.synopsis);
    await noteRepository.saveSynopsisCandidate(workspaceRoot, location, undefined);
    return 'written';
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
