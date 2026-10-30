import * as vscode from 'vscode';

import { createEmptyCard } from '@storyboard/story-model';
import type {
  StudioCardSeed,
  StoryboardResponsePayload,
  BibleSubjectKind,
} from '@storyboard/story-model';

import type { AiGateway, CreateCardResult } from '@storyboard/story-engine';
import type { CardManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

export interface StudioCardUpdateRpcHandlersDependencies {
  readonly aiGateway: AiGateway;
  readonly cards: Pick<CardManager, 'create'>;
  readonly logger: IStoryboardLogger;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

const unreadableSeedMessage: string =
  '설명에서 카드 이름을 읽지 못했어요. 이름을 앞세워 다시 적어 주시겠어요?';

export class StudioCardUpdateRpc {
  public constructor(private readonly deps: StudioCardUpdateRpcHandlersDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'studio.card.update': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.card.update'>> => {
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

        if (!root) {
          return { ok: false, message: 'Storyboard 프로젝트를 먼저 열어 주세요.' };
        }

        let seed: StudioCardSeed | undefined;

        try {
          seed = await this.deps.aiGateway
            .createService(root)
            .extractStudioCardSeed(payload.description, {
              providerId: this.deps.aiGateway.getTaskProvider('studioAgent'),
            });
        } catch (error) {
          this.deps.logger.warn(`Studio 카드 생성 준비 실패: ${String(error)}`);
          return { ok: false, message: '카드 정보를 뽑지 못했어요. 잠시 뒤 다시 시도해 주세요.' };
        }

        if (!seed) {
          return { ok: false, message: unreadableSeedMessage };
        }

        const cardType: 'character' | 'location' =
          seed.kind === 'character' ? 'character' : 'location';
        const instruction: string = fillInstruction(payload.description);

        let created: CreateCardResult;

        try {
          created = await this.deps.cards.create({
            workspaceRoot: root,
            cardType,
            id: seed.id,
            whenIdIsTaken: 'refuse',
            buildCard: (id) => createEmptyCard(cardType, id, seed.name),
          });
        } catch (error) {
          this.deps.logger.warn(`Studio 카드 생성 실패: ${String(error)}`);
          return { ok: false, message: '카드 파일을 만들지 못했어요.' };
        }

        if (!created.ok) {
          await openCardLeavingInstructionStagedOnFailure(root, seed);
          return {
            ok: true,
            message: `${cardFile(seed)} 는 이미 있어 그 카드를 열었어요.`,
            instruction,
          };
        }

        await vscode.window.showTextDocument(created.uri, { preview: true });

        return { ok: true, message: `${cardFile(seed)} 를 만들었어요.`, instruction };
      },
    };
  }
}

function fillInstruction(description: string): string {
  return `이 설명으로 카드를 채워줘.\n\n${description}`;
}

function cardFile(seed: StudioCardSeed): string {
  return `${seed.kind === 'character' ? 'character' : 'background'}/${seed.id}.card`;
}

async function openCardLeavingInstructionStagedOnFailure(
  root: vscode.Uri,
  seed: StudioCardSeed,
): Promise<void> {
  const directory: BibleSubjectKind = seed.kind === 'character' ? 'character' : 'background';

  try {
    await vscode.window.showTextDocument(vscode.Uri.joinPath(root, directory, `${seed.id}.card`), {
      preview: true,
    });
  } catch {
    return;
  }
}
