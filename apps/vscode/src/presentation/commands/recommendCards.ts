import * as vscode from 'vscode';

import { type RecommendCardsResult } from '@storyboard/story-engine';
import type { CardManager } from '@storyboard/story-app';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import type { RecommendationCategory } from '@storyboard/story-ai';
import { createEmptyBackground, createEmptyCharacter } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';
import type { RecommendedCard } from '@storyboard/story-engine';
import { needsCardIdPrompt, suggestCardId, validateCardId } from './createCard';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const recommendCharacterCommand = 'storyboard.character.recommend';
const recommendBackgroundCommand = 'storyboard.background.recommend';

export interface RecommendCardDependencies {
  readonly cards: Pick<CardManager, 'recommend' | 'deriveUniqueId' | 'write'>;
}

export function registerRecommendCardCommands(
  dependencies: RecommendCardDependencies,
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(recommendCharacterCommand, () =>
      recommendCards('character', dependencies),
    ),
    vscode.commands.registerCommand(recommendBackgroundCommand, () =>
      recommendCards('background', dependencies),
    ),
  );
}

async function recommendCards(
  category: RecommendationCategory,
  dependencies: RecommendCardDependencies,
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showWarningMessage('Storyboard 프로젝트를 먼저 열어 주세요.');
    return;
  }

  const result = await runCardRecommendation(category, workspaceRoot, dependencies);

  if (!result || result.kind === 'cancelled') {
    return;
  }

  if (result.kind === 'failed') {
    await showStoryboardFailure(result.message);
    return;
  }

  if (result.kind === 'no_sources') {
    await vscode.window.showInformationMessage('스캔할 scene 또는 draft가 없습니다.');
    return;
  }

  const { recommendations } = result;

  if (recommendations.length === 0) {
    await vscode.window.showInformationMessage(
      category === 'character'
        ? '추천할 새 캐릭터를 찾지 못했습니다.'
        : '추천할 새 배경을 찾지 못했습니다.',
    );
    return;
  }

  const picked = await pickRecommendations(category, recommendations);

  if (!picked || picked.length === 0) {
    return;
  }

  const created = await createCardsFromRecommendations(
    workspaceRoot,
    category,
    picked,
    dependencies.cards,
  );
  await vscode.window.showInformationMessage(
    `${created}개의 ${category === 'character' ? '캐릭터' : '배경'} 카드를 추가했습니다.`,
  );
}

async function runCardRecommendation(
  category: RecommendationCategory,
  workspaceRoot: vscode.Uri,
  dependencies: RecommendCardDependencies,
): Promise<RecommendCardsResult | undefined> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'scene·draft에서 새 카드를 찾는 중입니다…',
      cancellable: true,
    },
    async (_progress, token) => {
      return await dependencies.cards.recommend({
        category,
        shouldCancel: (): boolean => token.isCancellationRequested,
        workspaceRoot,
      });
    },
  );
}

interface RecommendationPick extends vscode.QuickPickItem {
  readonly recommendation: RecommendedCard;
}

async function pickRecommendations(
  category: RecommendationCategory,
  recommendations: readonly RecommendedCard[],
): Promise<RecommendedCard[] | undefined> {
  const items: RecommendationPick[] = recommendations.map((recommendation) => ({
    label: recommendation.name,
    ...(recommendation.role ? { description: recommendation.role } : {}),
    detail: buildRecommendationDetail(recommendation),
    picked: true,
    recommendation,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: category === 'character' ? '추가할 캐릭터 선택' : '추가할 배경 선택',
    placeHolder: '카드로 추가할 항목을 선택하세요.',
  });

  return selected?.map((item) => item.recommendation);
}

function buildRecommendationDetail(recommendation: RecommendedCard): string {
  const parts: string[] = [];

  if (recommendation.description) {
    parts.push(recommendation.description);
  }

  if (recommendation.sourceScenes.length > 0) {
    parts.push(`출처 · ${recommendation.sourceScenes.join(', ')}`);
  }

  return parts.join('  ·  ');
}

async function createCardsFromRecommendations(
  workspaceRoot: vscode.Uri,
  category: RecommendationCategory,
  recommendations: readonly RecommendedCard[],
  cards: Pick<CardManager, 'deriveUniqueId' | 'write'>,
): Promise<number> {
  const cardType: StoryboardCard['type'] = category === 'character' ? 'character' : 'location';
  let created = 0;

  for (const recommendation of recommendations) {
    const base = await askCardIdBase(recommendation.name, category);

    if (base === null) {
      continue;
    }

    const id = await cards.deriveUniqueId(
      workspaceRoot,
      cardType,
      base ?? suggestCardId(recommendation.name),
      cardType === 'character' ? 'character' : 'background',
    );
    await cards.write(workspaceRoot, buildCardFromRecommendation(category, id, recommendation));
    created += 1;
  }

  return created;
}

async function askCardIdBase(
  name: string,
  category: RecommendationCategory,
): Promise<string | null | undefined> {
  if (!needsCardIdPrompt(name)) {
    return undefined;
  }

  const label = category === 'character' ? '캐릭터' : '배경';
  const input = await vscode.window.showInputBox({
    title: `${name} — 파일 ID 지정`,
    prompt: `영문 소문자·숫자·하이픈만 사용 가능. ${label} 폴더의 파일명으로 쓰입니다.`,
    ignoreFocusOut: true,
    validateInput: validateCardId,
  });

  return input === undefined ? null : input;
}

function buildCardFromRecommendation(
  category: RecommendationCategory,
  id: string,
  recommendation: RecommendedCard,
): StoryboardCard {
  const description = recommendation.description
    ? { description: [recommendation.description] }
    : {};

  if (category === 'character') {
    return {
      ...createEmptyCharacter(id, recommendation.name),
      ...(recommendation.role ? { role: recommendation.role } : {}),
      ...description,
    };
  }

  return {
    ...createEmptyBackground(id, recommendation.name),
    ...description,
  };
}
