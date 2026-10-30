import type { WorkspaceRepositories } from '#engine/application/engineServices';
import type { IUseCase } from '#engine/application/useCase';
import type { StoryUri, StoryboardCard } from '@storyboard/story-model';

export type CardIdCollisionPolicy = 'refuse' | 'number-it';

export interface CreateCardRequest {
  readonly workspaceRoot: StoryUri;
  readonly cardType: StoryboardCard['type'];
  readonly id: string;
  readonly fallbackId?: string;
  readonly whenIdIsTaken: CardIdCollisionPolicy;
  readonly buildCard: (id: string) => StoryboardCard;
}

export type CreateCardResult =
  | { readonly ok: true; readonly kind: 'created'; readonly id: string; readonly uri: StoryUri }
  | { readonly ok: false; readonly kind: 'id-taken'; readonly id: string };

const placeholderCardId: string = 'new-card';

export class CreateCardUseCase implements IUseCase<CreateCardRequest, CreateCardResult> {
  public constructor(private readonly repositories: WorkspaceRepositories) {}

  public async execute(request: CreateCardRequest): Promise<CreateCardResult> {
    const { workspaceRoot, cardType } = request;
    const isTakenIdRefused: boolean = request.whenIdIsTaken === 'refuse';

    if (isTakenIdRefused && (await this.exists(workspaceRoot, cardType, request.id))) {
      return { ok: false, kind: 'id-taken', id: request.id };
    }

    const id: string = isTakenIdRefused
      ? request.id
      : await this.deriveUniqueId(request, request.fallbackId ?? request.id);
    const uri: StoryUri = await this.repositories.cardWriter.write(
      workspaceRoot,
      request.buildCard(id),
    );

    return { ok: true, kind: 'created', id, uri };
  }

  private async deriveUniqueId(request: CreateCardRequest, fallbackId: string): Promise<string> {
    const base: string = request.id === placeholderCardId ? fallbackId : request.id;
    let candidate: string = base;
    let suffix: number = 2;

    while (await this.exists(request.workspaceRoot, request.cardType, candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private exists(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return this.repositories.cardWriter.exists(workspaceRoot, cardType, id);
  }
}
