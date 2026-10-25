import * as vscode from 'vscode';

import { createEmptyBackground, createEmptyCharacter } from '@storyboard/story-model';
import type {
  StudioCardSeed,
  StoryboardResponsePayload,
  StoryUri,
  Character,
  LocationBackgroundCard,
} from '@storyboard/story-model';

import type { AiGateway } from '@storyboard/story-engine';
import type { CardManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

export interface StudioCardUpdateRpcHandlersDependencies {
  readonly aiGateway: AiGateway;
  readonly cards: Pick<CardManager, 'exists' | 'write'>;
  readonly logger: IStoryboardLogger;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

const unreadableSeedMessage: string =
  '설명에서 카드 이름을 읽지 못했어요. 이름을 앞세워 다시 적어 주시겠어요?';

export function createStudioCardUpdateRpcHandlers(
  deps: StudioCardUpdateRpcHandlersDependencies,
): StoryboardRpcHandlers {
  return {
    'studio.card.update': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.card.update'>> => {
      const root: vscode.Uri | undefined = await deps.getProjectRoot();

      if (!root) {
        return { ok: false, message: 'Storyboard 프로젝트를 먼저 열어 주세요.' };
      }

      let seed: StudioCardSeed | undefined;

      try {
        seed = await deps.aiGateway.createService(root).extractStudioCardSeed(payload.description, {
          providerId: deps.aiGateway.getTaskProvider('studioAgent'),
        });
      } catch (error) {
        deps.logger.warn(`Studio 카드 생성 준비 실패: ${String(error)}`);
        return { ok: false, message: '카드 정보를 뽑지 못했어요. 잠시 뒤 다시 시도해 주세요.' };
      }

      if (!seed) {
        return { ok: false, message: unreadableSeedMessage };
      }

      const cardType: 'character' | 'location' =
        seed.kind === 'character' ? 'character' : 'location';
      const instruction: string = fillInstruction(payload.description);

      if (await deps.cards.exists(root, cardType, seed.id)) {
        await openCardLeavingInstructionStagedOnFailure(root, seed);
        return {
          ok: true,
          message: `${cardFile(seed)} 는 이미 있어 그 카드를 열었어요.`,
          instruction,
        };
      }

      const card: Character | LocationBackgroundCard =
        seed.kind === 'character'
          ? createEmptyCharacter(seed.id, seed.name)
          : createEmptyBackground(seed.id, seed.name);

      try {
        const uri: StoryUri = await deps.cards.write(root, card);
        await vscode.window.showTextDocument(uri, { preview: true });
      } catch (error) {
        deps.logger.warn(`Studio 카드 생성 실패: ${String(error)}`);
        return { ok: false, message: '카드 파일을 만들지 못했어요.' };
      }

      return { ok: true, message: `${cardFile(seed)} 를 만들었어요.`, instruction };
    },
  };
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
  const directory: 'character' | 'background' =
    seed.kind === 'character' ? 'character' : 'background';

  try {
    await vscode.window.showTextDocument(vscode.Uri.joinPath(root, directory, `${seed.id}.card`), {
      preview: true,
    });
  } catch {
    return;
  }
}
