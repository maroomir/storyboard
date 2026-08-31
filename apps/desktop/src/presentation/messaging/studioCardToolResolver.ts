import * as vscode from 'vscode';

import type { StudioAgentInvokeRequest, StudioValidationVerdict } from '@storyboard/story-ai';
import { parseCard, parseSceneCard, isBackgroundCard } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';

import type { AiGateway } from '../../application/ai/aiGateway';
import type { CollectCardProposalsUseCase } from '../../application/cards/collectCardProposalsUseCase';
import type { CardCollectProposal } from '@storyboard/story-engine';
import type { StudioEntity } from '@storyboard/story-engine';
import type { StoryboardLogger } from '@storyboard/story-engine';
import {
  backgroundCardPath,
  characterCardPath,
  isSafeStudioEntityKey,
} from '@storyboard/story-engine';

export interface StudioCardToolResolverDependencies {
  readonly aiGateway: AiGateway;
  readonly collectUseCase: CollectCardProposalsUseCase;
  readonly logger: StoryboardLogger;
}

export interface StudioCardToolResolverInput {
  readonly workspaceRoot: vscode.Uri;
  readonly entity: StudioEntity;
  readonly entityLabel: string;
  readonly context: string;
  readonly baseline: string;
}

const maxReportedItems = 15;

export function createStudioCardInvokeResolver(
  deps: StudioCardToolResolverDependencies,
  input: StudioCardToolResolverInput,
): (request: StudioAgentInvokeRequest) => Promise<string> {
  return async (request) => {
    try {
      switch (request.tool) {
        case 'collectFromDrafts':
          return await runCollect(deps, input);
        case 'cardAudit':
          return await runAudit(deps, input);
        case 'relationCheck':
          return await runRelationCheck(input);
        default:
          return `[도구 실패: ${request.tool}] 이 대화에서는 쓸 수 없는 도구다.`;
      }
    } catch (error) {
      deps.logger.warn(`Studio 카드 도구 실행 실패(${request.tool}): ${String(error)}`);
      return `[도구 실패: ${request.tool}] 실행 중 오류가 나서 결과를 얻지 못했다. 도구 없이 판단하라.`;
    }
  };
}

async function runCollect(
  deps: StudioCardToolResolverDependencies,
  input: StudioCardToolResolverInput,
): Promise<string> {
  if (input.entity.kind === 'scene') {
    return '[도구 실패: collectFromDrafts] 씬 대화에서는 쓸 수 없는 도구다.';
  }

  let card: StoryboardCard;

  try {
    card = parseCard(input.baseline);
  } catch {
    return '[도구 실패: collectFromDrafts] 카드를 읽지 못해 수집할 수 없었다.';
  }

  const proposals = await deps.collectUseCase.execute(input.workspaceRoot, card);

  if (proposals.length === 0) {
    return '[도구 결과: collectFromDrafts] 초안에서 카드에 더할 새 정보를 찾지 못했다.';
  }

  return [
    `[도구 결과: collectFromDrafts] 후보 ${proposals.length}건. 대화 맥락에 맞는 것만 골라 다듬어 propose하라.`,
    ...proposals.slice(0, maxReportedItems).map(describeCollectProposal),
    ...(proposals.length > maxReportedItems
      ? [`- 외 ${proposals.length - maxReportedItems}건은 카드 에디터의 수집 탭에서 확인.`]
      : []),
  ].join('\n');
}

async function runAudit(
  deps: StudioCardToolResolverDependencies,
  input: StudioCardToolResolverInput,
): Promise<string> {
  const verdict: StudioValidationVerdict = await deps.aiGateway
    .createService(input.workspaceRoot)
    .auditStudioEntity(
      {
        entityLabel: input.entityLabel,
        cardText: input.baseline,
        context: input.context,
      },
      { providerId: deps.aiGateway.getTaskProvider('studioValidation') },
    );

  if (verdict.state === 'skipped') {
    return '[도구 결과: cardAudit] 판정을 읽지 못해 검사를 건너뛰었다.';
  }

  if (verdict.warnings.length === 0) {
    return '[도구 결과: cardAudit] 자료와 어긋나는 점이 없다.';
  }

  return [
    `[도구 결과: cardAudit] 어긋남 ${verdict.warnings.length}건`,
    ...verdict.warnings.map(
      (warning) => `- ${warning.message}${warning.source ? ` (근거: ${warning.source})` : ''}`,
    ),
  ].join('\n');
}

// NOTE: reference integrity is a filesystem fact, so this tool spends no AI call — it walks the
// cards and reports dangling targets and one-way relations directly.
async function runRelationCheck(input: StudioCardToolResolverInput): Promise<string> {
  const lines =
    input.entity.kind === 'scene'
      ? await checkSceneReferences(input)
      : await checkCardRelations(input);

  if (lines.length === 0) {
    return '[도구 결과: relationCheck] 끊어진 참조가 없다.';
  }

  return [`[도구 결과: relationCheck] 문제 ${lines.length}건`, ...lines].join('\n');
}

async function checkSceneReferences(input: StudioCardToolResolverInput): Promise<string[]> {
  const scene = parseSceneCard(input.baseline);
  const lines: string[] = [];

  for (const id of scene.characters ?? []) {
    if (!(await cardExists(characterCardPath, input.workspaceRoot, id))) {
      lines.push(`- characters의 ${id} — character/${id}.card 가 없다.`);
    }
  }

  const location = scene.location;

  if (
    location !== undefined &&
    !(await cardExists(backgroundCardPath, input.workspaceRoot, location))
  ) {
    lines.push(`- location의 ${location} — background/${location}.card 가 없다.`);
  }

  return lines;
}

async function checkCardRelations(input: StudioCardToolResolverInput): Promise<string[]> {
  const card = parseCard(input.baseline);
  const lines: string[] = [];

  if (isBackgroundCard(card)) {
    for (const id of card.characterIds) {
      if (!(await cardExists(characterCardPath, input.workspaceRoot, id))) {
        lines.push(`- characterIds의 ${id} — character/${id}.card 가 없다.`);
      }
    }

    return lines;
  }

  for (const relation of card.relations ?? []) {
    // SECURITY: the target becomes a file path, so an unsafe id is reported broken, never read.
    const targetText = isSafeStudioEntityKey(relation.target)
      ? await readCardText(characterCardPath(input.workspaceRoot, relation.target))
      : undefined;

    if (targetText === undefined) {
      lines.push(
        `- 관계 ${relation.target}(${relation.type}) — character/${relation.target}.card 가 없다.`,
      );
      continue;
    }

    if (!hasRelationBack(targetText, card.id)) {
      lines.push(
        `- 관계 ${relation.target}(${relation.type}) — 상대 카드에는 ${card.id} 방향 관계가 없다(일방향).`,
      );
    }
  }

  return lines;
}

function hasRelationBack(targetCardText: string, sourceId: string): boolean {
  try {
    const target = parseCard(targetCardText);
    return (
      !isBackgroundCard(target) &&
      (target.relations ?? []).some((relation) => relation.target === sourceId)
    );
  } catch {
    return false;
  }
}

async function cardExists(
  pathOf: (root: vscode.Uri, id: string) => vscode.Uri,
  root: vscode.Uri,
  id: string,
): Promise<boolean> {
  if (!isSafeStudioEntityKey(id)) {
    return false;
  }

  try {
    await vscode.workspace.fs.stat(pathOf(root, id));
    return true;
  } catch {
    return false;
  }
}

async function readCardText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

function describeCollectProposal(proposal: CardCollectProposal): string {
  const sources =
    proposal.sourceScenes.length > 0 ? ` (출처: ${proposal.sourceScenes.join(', ')})` : '';

  switch (proposal.kind) {
    case 'attribute':
      return `- 속성 ${proposal.key}: ${proposal.value}${sources}`;
    case 'relation':
      return `- 관계 ${proposal.target}: ${proposal.type}${sources}`;
    case 'arc':
      return `- 아크 ${proposal.sceneRef}: ${proposal.summary}${sources}`;
    case 'scalar':
      return `- ${proposal.field}: ${proposal.after}${sources}`;
    default:
      return `- ${proposal.kind}: ${proposal.value}${sources}`;
  }
}
