import {
  createEmptyCard,
  slugify,
  type StoryUri,
  type UsageAttribution,
} from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import type {
  CardIdCollisionPolicy,
  CreateCardResult,
  CreateCardUseCase,
} from '#engine/application/cards/createCardUseCase';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type {
  CreateSceneResult,
  CreateSceneUseCase,
} from '#engine/application/drafts/createSceneUseCase';
import type {
  StudioEditResult,
  StudioEditUseCase,
} from '#engine/application/studio/studioEditUseCase';

export type StudioCreatableKind = 'character' | 'background' | 'scene';

export interface StudioCreateUseCaseDependencies {
  readonly createCard: CreateCardUseCase;
  readonly createScene: CreateSceneUseCase;
  readonly edit: StudioEditUseCase;
  readonly cards: WorkspaceCards;
}

export interface StudioCreateRequest {
  readonly workspaceRoot: StoryUri;
  readonly kind: StudioCreatableKind;
  readonly slug?: string;
  readonly name?: string;
  readonly description: string;
  readonly shouldPropose: boolean;
  readonly isValidationEnabled: boolean;
  readonly attribution?: UsageAttribution;
  readonly whenSlugIsTaken?: CardIdCollisionPolicy;
  readonly isPreview?: boolean;
  readonly after?: string;
}

export type StudioCreateResult =
  | {
      readonly ok: true;
      readonly kind: 'created';
      readonly key: string;
      readonly uri: StoryUri;
      readonly edit: StudioEditResult;
    }
  | { readonly ok: false; readonly kind: 'exists' | 'failed'; readonly message: string };

type CreatedElement =
  | { readonly ok: true; readonly key: string; readonly uri: StoryUri }
  | { readonly ok: false; readonly kind: 'exists' | 'failed'; readonly message: string };

type StudioCreatableCardKind = Exclude<StudioCreatableKind, 'scene'>;

const provisionalCardNames: Readonly<Record<StudioCreatableCardKind, string>> = {
  character: '새 인물',
  background: '새 배경',
};

interface CardIdentity {
  readonly slug: string;
  readonly name: string;
  readonly whenSlugIsTaken: CardIdCollisionPolicy;
}

function resolveCardIdentity(
  kind: StudioCreatableCardKind,
  request: StudioCreateRequest,
): CardIdentity {
  const name: string = request.name?.trim() || provisionalCardNames[kind];
  const isSlugGiven: boolean = request.slug !== undefined;

  return {
    slug: request.slug ?? slugify(name) ?? `new-${kind}`,
    name,
    whenSlugIsTaken: request.whenSlugIsTaken ?? (isSlugGiven ? 'refuse' : 'number-it'),
  };
}

export function composeCreationInstruction(description: string): string {
  return `새로 만든 카드입니다. 아래 설명을 읽고 이 카드의 빈 칸을 채워 주세요.\n\n${description.trim()}`;
}

export class StudioCreateUseCase implements IUseCase<StudioCreateRequest, StudioCreateResult> {
  public constructor(private readonly dependencies: StudioCreateUseCaseDependencies) {}

  public async execute(request: StudioCreateRequest): Promise<StudioCreateResult> {
    const created: CreatedElement =
      request.kind === 'scene' ? await this.createScene(request) : await this.createCard(request);
    if (!created.ok) {
      return created;
    }

    const isPreview: boolean = request.isPreview === true && request.kind !== 'scene';
    const edit: StudioEditResult = await this.dependencies.edit.execute({
      workspaceRoot: request.workspaceRoot,
      entity: { kind: request.kind, key: created.key },
      instruction: composeCreationInstruction(request.description),
      shouldPropose: request.shouldPropose || isPreview,
      isValidationEnabled: request.isValidationEnabled,
      ...(request.attribution === undefined ? {} : { attribution: request.attribution }),
    });

    if (isPreview && request.kind !== 'scene') {
      await this.dependencies.cards.remove(request.workspaceRoot, request.kind, created.key);
    }

    return { ok: true, kind: 'created', key: created.key, uri: created.uri, edit };
  }

  private async createScene(request: StudioCreateRequest): Promise<CreatedElement> {
    const result: CreateSceneResult = await this.dependencies.createScene.execute({
      workspaceRoot: request.workspaceRoot,
      ...(request.slug === undefined ? {} : { slug: request.slug }),
      ...(request.after === undefined ? {} : { after: request.after }),
    });
    if (result.ok) {
      return { ok: true, key: result.stem, uri: result.uri };
    }

    return {
      ok: false,
      kind: result.kind === 'exists' ? 'exists' : 'failed',
      message: result.message,
    };
  }

  private async createCard(request: StudioCreateRequest): Promise<CreatedElement> {
    const kind: StudioCreatableCardKind = request.kind === 'character' ? 'character' : 'background';
    const cardType: 'character' | 'location' = kind === 'character' ? 'character' : 'location';
    const identity: CardIdentity = resolveCardIdentity(kind, request);
    const result: CreateCardResult = await this.dependencies.createCard.execute({
      workspaceRoot: request.workspaceRoot,
      cardType,
      id: identity.slug,
      whenIdIsTaken: identity.whenSlugIsTaken,
      buildCard: (id) => createEmptyCard(cardType, id, identity.name),
    });

    return result.ok
      ? { ok: true, key: result.id, uri: result.uri }
      : { ok: false, kind: 'exists', message: `이미 있는 카드입니다: ${result.id}` };
  }
}
