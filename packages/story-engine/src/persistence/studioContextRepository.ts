import {
  backgroundCardPath,
  buildSceneContext,
  characterCardPath,
  characterMatchTokens,
  detectCharactersInText,
  draftHistorySceneDirectory,
  draftPath,
  extractDraftBody,
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  isSafeStudioEntityKey,
  nextDraftHistoryRevision,
  parseDraft,
  parseSceneFileName,
  readRevisionPlanFile,
  sceneContextPaths,
  scenePath,
  serializeCard,
} from '@storyboard/story-model';
import type {
  BibleSubjectKind,
  RevisionPlan,
  RevisionPlanEntry,
  SceneContext,
  SceneFile,
  StoryboardCard,
  StoryboardProjectPaths,
  StoryUri,
  StudioAgentEntityKind,
  StudioAgentFollowUp,
  StudioAgentLookupRequest,
  StudioCardStage,
  StudioEntity,
  StudioFollowUpTarget,
  StudioPatchTarget,
  StudioSceneStage,
  StudioStage,
  StudioStageCard,
  StudioTarget,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';

export interface StudioEntityContext {
  readonly agentEntityKind: StudioAgentEntityKind;
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly targetUri: StoryUri | undefined;
  readonly patchTarget: StudioPatchTarget;
  readonly context: string;
  readonly baseline: string | undefined;
}

export type StudioSceneFocus = 'card' | 'draft';

type DraftFacts = Pick<StudioSceneStage, 'draftLength' | 'draftUpdatedAt' | 'draftRevision'>;

const missingDraftNote: string =
  '이 씬에는 아직 초안이 없다. 초안을 만들기 전에는 고칠 대상이 없으니 propose하지 말고 say로 알려라.';

function followUpTargetFile(followUp: StudioAgentFollowUp): string {
  return followUp.kind === 'scene'
    ? `scene/${followUp.key}.card`
    : relativeCardPath(followUp.kind, followUp.key);
}

function followUpUri(workspaceRoot: StoryUri, followUp: StudioAgentFollowUp): StoryUri {
  return followUp.kind === 'scene'
    ? scenePath(workspaceRoot, followUp.key)
    : cardPathFor(workspaceRoot, followUp.kind, followUp.key);
}

function cardPathFor(
  workspaceRoot: StoryUri,
  cardKind: BibleSubjectKind,
  cardId: string,
): StoryUri {
  return cardKind === 'character'
    ? characterCardPath(workspaceRoot, cardId)
    : backgroundCardPath(workspaceRoot, cardId);
}

function relativeCardPath(cardKind: BibleSubjectKind, cardId: string): string {
  return `${cardKind}/${cardId}.card`;
}

function sceneDeclaresCard(scene: SceneFile, cardId: string, cardKind: BibleSubjectKind): boolean {
  return cardKind === 'character'
    ? (scene.frontmatter.characters?.includes(cardId) ?? false)
    : scene.frontmatter.location === cardId;
}

function sceneFeaturesCard(scene: SceneFile, card: StoryboardCard): boolean {
  if (card.type === 'character') {
    if (scene.frontmatter.characters?.includes(card.id)) {
      return true;
    }

    return detectCharactersInText(scene.body, characterMatchTokens(card)).length > 0;
  }

  if (scene.frontmatter.location === card.id) {
    return true;
  }

  return detectCharactersInText(scene.body, [card.name, ...(card.aliases ?? [])]).length > 0;
}

function toStageRelation(relation: {
  readonly target: string;
  readonly type: string;
}): StudioCardStage['relations'][number] {
  return { target: relation.target, type: relation.type };
}

function resolveSceneStem(target: StudioTarget): string | undefined {
  if (!target.sceneUri) {
    return undefined;
  }

  const fileName: string = target.sceneUri.split('/').pop() ?? '';
  return parseSceneFileName(fileName)?.stem;
}

function draftBodyLength(rawDraft: string): number {
  try {
    return parseDraft(rawDraft).body.trim().length;
  } catch {
    return rawDraft.trim().length;
  }
}

export class StudioContextRepository {
  private readonly files: WorkspaceFiles;

  public constructor(private readonly fileSystem: IFileSystem) {
    this.files = new WorkspaceFiles(fileSystem);
  }

  public async readEntityContext(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    sceneFocus: StudioSceneFocus = 'draft',
  ): Promise<StudioEntityContext | undefined> {
    if (!isSafeStudioEntityKey(entity.key)) {
      return undefined;
    }

    if (entity.kind === 'character' || entity.kind === 'background') {
      return this.readCardContext(workspaceRoot, entity.kind, entity.key);
    }

    return entity.kind === 'scene'
      ? this.readSceneContext(workspaceRoot, entity.key, sceneFocus)
      : undefined;
  }

  public async resolveLookups(
    workspaceRoot: StoryUri,
    requests: readonly StudioAgentLookupRequest[],
  ): Promise<string> {
    const safeRequests: StudioAgentLookupRequest[] = requests.filter((request) =>
      isSafeStudioEntityKey(request.key),
    );

    const sections: string[] = await Promise.all(
      safeRequests.map(async (request) => {
        const text: string | undefined = await this.readLookupText(workspaceRoot, request);
        return `[조회: ${request.kind}/${request.key}]\n${text ?? '찾을 수 없음'}`;
      }),
    );

    return sections.join('\n\n');
  }

  public async resolveFollowUps(
    workspaceRoot: StoryUri,
    followUps: readonly StudioAgentFollowUp[],
  ): Promise<readonly StudioFollowUpTarget[]> {
    const resolved: (StudioFollowUpTarget | undefined)[] = await Promise.all(
      followUps
        .filter((followUp) => isSafeStudioEntityKey(followUp.key))
        .map(async (followUp) => {
          const targetFile: string = followUpTargetFile(followUp);
          const exists: boolean = await this.fileSystem.exists(
            followUpUri(workspaceRoot, followUp),
          );

          return exists ? { ...followUp, targetFile } : undefined;
        }),
    );

    return resolved.filter((followUp): followUp is StudioFollowUpTarget => followUp !== undefined);
  }

  public async readStage(
    workspaceRoot: StoryUri,
    target: StudioTarget,
  ): Promise<StudioStage | undefined> {
    const entity: StudioEntity | undefined = target.entity;

    if (entity?.kind === 'character' || entity?.kind === 'background') {
      return this.readCardStage(workspaceRoot, entity.kind, entity.key);
    }

    const sceneStem: string | undefined =
      entity?.kind === 'scene' ? entity.key : resolveSceneStem(target);

    return sceneStem ? this.readSceneStage(workspaceRoot, sceneStem) : undefined;
  }

  private async readCardContext(
    workspaceRoot: StoryUri,
    cardKind: BibleSubjectKind,
    cardId: string,
  ): Promise<StudioEntityContext | undefined> {
    const targetUri: StoryUri = cardPathFor(workspaceRoot, cardKind, cardId);
    const baseline: string | undefined = await this.readTextOrUndefined(targetUri);

    if (baseline === undefined) {
      return undefined;
    }

    const relatedScenes: string[] = await this.readScenesFeaturingCard(
      workspaceRoot,
      cardId,
      cardKind,
    );

    return {
      agentEntityKind: cardKind,
      entityLabel: cardId,
      targetFile: relativeCardPath(cardKind, cardId),
      targetUri,
      patchTarget: 'entityCard',
      baseline,
      context: [
        `[현재 카드: ${relativeCardPath(cardKind, cardId)}]`,
        baseline.trim(),
        '',
        '[이 카드가 등장하는 씬]',
        relatedScenes.length > 0 ? relatedScenes.join('\n\n') : '없음',
      ].join('\n'),
    };
  }

  private async readSceneContext(
    workspaceRoot: StoryUri,
    sceneStem: string,
    sceneFocus: StudioSceneFocus,
  ): Promise<StudioEntityContext | undefined> {
    const sceneUri: StoryUri = scenePath(workspaceRoot, sceneStem);
    const sceneText: string | undefined = await this.readTextOrUndefined(sceneUri);

    if (sceneText === undefined) {
      return undefined;
    }

    const draftUri: StoryUri = draftPath(workspaceRoot, sceneStem);
    const draftText: string | undefined = await this.readTextOrUndefined(draftUri);
    const draftBody: string | undefined =
      draftText === undefined ? undefined : extractDraftBody(draftText);

    const context: string = [
      `[씬 시드: scene/${sceneStem}.card]`,
      sceneText.trim(),
      '',
      '[초안 본문]',
      draftBody === undefined ? missingDraftNote : draftBody,
    ].join('\n');

    if (sceneFocus === 'card') {
      return {
        agentEntityKind: 'scene',
        entityLabel: sceneStem,
        targetFile: `scene/${sceneStem}.card`,
        targetUri: sceneUri,
        patchTarget: 'sceneCard',
        baseline: sceneText,
        context,
      };
    }

    return {
      agentEntityKind: 'scene',
      entityLabel: sceneStem,
      targetFile: `draft/${sceneStem}.md`,
      targetUri: draftText === undefined ? undefined : draftUri,
      patchTarget: 'draft',
      baseline: draftText,
      context,
    };
  }

  private async readScenesFeaturingCard(
    workspaceRoot: StoryUri,
    cardId: string,
    cardKind: BibleSubjectKind,
  ): Promise<string[]> {
    const stems: string[] = await this.listSceneStems(workspaceRoot);

    const sections: (string | undefined)[] = await Promise.all(
      stems.map(async (stem) => {
        const scene: SceneFile | undefined = await this.files.readSceneOrUndefined(
          workspaceRoot,
          stem,
        );

        if (!scene || !sceneDeclaresCard(scene, cardId, cardKind)) {
          return undefined;
        }

        return [
          `- scene/${stem}.card: ${scene.frontmatter.title ?? stem}`,
          scene.body.trim().length > 0 ? `  ${scene.body.trim()}` : '',
        ]
          .filter((line) => line.length > 0)
          .join('\n');
      }),
    );

    return sections.filter((section): section is string => section !== undefined);
  }

  private async readLookupText(
    workspaceRoot: StoryUri,
    request: StudioAgentLookupRequest,
  ): Promise<string | undefined> {
    switch (request.kind) {
      case 'character':
      case 'background': {
        const card: StoryboardCard | undefined = await this.files.readCardOrUndefined(
          cardPathFor(workspaceRoot, request.kind, request.key),
        );
        return card ? serializeCard(card).trim() : undefined;
      }
      case 'scene': {
        const scene: SceneFile | undefined = await this.files.readSceneOrUndefined(
          workspaceRoot,
          request.key,
        );
        return scene ? scene.body.trim() : undefined;
      }
      case 'draft': {
        const draft: string | undefined = await this.readTextOrUndefined(
          draftPath(workspaceRoot, request.key),
        );
        return draft === undefined ? undefined : extractDraftBody(draft);
      }
    }
  }

  private async readSceneStage(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<StudioSceneStage> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const scene: SceneFile | undefined = await this.files.readSceneOrUndefined(
      workspaceRoot,
      sceneStem,
    );

    const [cards, draft, review] = await Promise.all([
      scene ? this.readStageCards(paths, scene) : Promise.resolve([]),
      this.readDraftFacts(workspaceRoot, sceneStem),
      this.readReviewState(paths.outlineRevisionPlan, sceneStem),
    ]);

    return { kind: 'scene', sceneStem, title: scene?.frontmatter.title, cards, review, ...draft };
  }

  private async readCardStage(
    workspaceRoot: StoryUri,
    cardKind: BibleSubjectKind,
    cardId: string,
  ): Promise<StudioCardStage | undefined> {
    const card: StoryboardCard | undefined = await this.files.readCardOrUndefined(
      cardPathFor(workspaceRoot, cardKind, cardId),
    );

    if (!card) {
      return undefined;
    }

    return {
      kind: 'card',
      cardKind,
      cardId,
      name: card.name,
      ...(card.type === 'character' && card.role ? { role: card.role } : {}),
      relations: card.type === 'character' ? (card.relations ?? []).map(toStageRelation) : [],
      appearsInScenes: await this.findScenesFeaturingCard(workspaceRoot, card),
    };
  }

  private async findScenesFeaturingCard(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
  ): Promise<string[]> {
    const stems: string[] = await this.listSceneStems(workspaceRoot);

    const matches: (string | undefined)[] = await Promise.all(
      stems.map(async (stem) => {
        const scene: SceneFile | undefined = await this.files.readSceneOrUndefined(
          workspaceRoot,
          stem,
        );
        return scene && sceneFeaturesCard(scene, card) ? stem : undefined;
      }),
    );

    return matches.filter((stem): stem is string => stem !== undefined);
  }

  private async listSceneStems(workspaceRoot: StoryUri): Promise<string[]> {
    const names: readonly string[] = await this.files.listNames(
      getStoryboardProjectPaths(workspaceRoot).sceneDirectory,
      (name) => !isIgnoredSampleCardFileName(name),
    );

    return names
      .map((name) => parseSceneFileName(name)?.stem)
      .filter((stem): stem is string => stem !== undefined)
      .sort();
  }

  private async readStageCards(
    paths: StoryboardProjectPaths,
    scene: SceneFile,
  ): Promise<StudioStageCard[]> {
    try {
      const context: SceneContext = await buildSceneContext(
        sceneContextPaths(paths),
        scene,
        this.fileSystem,
      );
      const characters: StudioStageCard[] = context.characters.map(
        (character): StudioStageCard => ({ kind: 'character', name: character.name }),
      );

      return context.background
        ? [...characters, { kind: 'background', name: context.background.name }]
        : characters;
    } catch {
      return [];
    }
  }

  private async readDraftFacts(workspaceRoot: StoryUri, sceneStem: string): Promise<DraftFacts> {
    const uri: StoryUri = draftPath(workspaceRoot, sceneStem);

    try {
      const [modifiedAt, bytes] = await Promise.all([
        this.fileSystem.modifiedTime(uri),
        this.fileSystem.readFile(uri),
      ]);

      return {
        draftLength: draftBodyLength(new TextDecoder().decode(bytes)),
        draftUpdatedAt: new Date(modifiedAt).toISOString(),
        draftRevision: await this.readDraftRevision(workspaceRoot, sceneStem),
      };
    } catch {
      return {};
    }
  }

  private async readDraftRevision(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<number | undefined> {
    try {
      const fileNames: readonly string[] = await this.fileSystem.listFileNames(
        draftHistorySceneDirectory(workspaceRoot, sceneStem),
      );

      const currentRevision: number = nextDraftHistoryRevision(fileNames);

      return currentRevision > 1 ? currentRevision : undefined;
    } catch {
      return undefined;
    }
  }

  private async readReviewState(
    revisionPlanUri: StoryUri,
    sceneStem: string,
  ): Promise<StudioSceneStage['review']> {
    try {
      const plan: RevisionPlan = await readRevisionPlanFile(revisionPlanUri, this.fileSystem);
      const entry: RevisionPlanEntry | undefined = plan.entries.find(
        (candidate) => candidate.sceneStem === sceneStem,
      );

      if (!entry) {
        return 'unreviewed';
      }

      return entry.remainingBlocking === 0 ? 'clean' : 'issues';
    } catch {
      return 'unreviewed';
    }
  }

  private async readTextOrUndefined(uri: StoryUri): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await this.fileSystem.readFile(uri));
    } catch {
      return undefined;
    }
  }
}
