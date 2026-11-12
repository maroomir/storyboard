import * as vscode from 'vscode';

import type {
  StudioAgentInvokeRequest,
  StudioValidationVerdict,
  StoryboardCard,
  CardCollectProposal,
  StudioEntity,
  SceneCard,
} from '@storyboard/story-model';
import {
  parseCard,
  parseSceneCard,
  isBackgroundCard,
  isSafeStudioEntityKey,
} from '@storyboard/story-model';

import type { AiGateway } from '@storyboard/story-engine';
import type { CardManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';

export interface StudioCardToolResolverDependencies {
  readonly aiGateway: AiGateway;
  readonly cards: Pick<CardManager, 'collectProposals' | 'read'>;
  readonly logger: IStoryboardLogger;
}

export interface StudioCardToolResolverInput {
  readonly workspaceRoot: vscode.Uri;
  readonly entity: StudioEntity;
  readonly entityLabel: string;
  readonly context: string;
  readonly baseline: string;
}

const maxReportedItems: number = 15;

type CardReader = Pick<CardManager, 'read'>;

async function runRelationCheck(
  input: StudioCardToolResolverInput,
  cards: CardReader,
): Promise<string> {
  const lines: string[] =
    input.entity.kind === 'scene'
      ? await checkSceneReferences(input, cards)
      : await checkCardRelations(input, cards);

  if (lines.length === 0) {
    return '[도구 결과: relationCheck] 끊어진 참조가 없다.';
  }

  return [`[도구 결과: relationCheck] 문제 ${lines.length}건`, ...lines].join('\n');
}

async function checkSceneReferences(
  input: StudioCardToolResolverInput,
  cards: CardReader,
): Promise<string[]> {
  const scene: SceneCard = parseSceneCard(input.baseline);
  const lines: string[] = [];

  for (const id of scene.characters ?? []) {
    if (!(await hasCardOfKind(cards, input.workspaceRoot, 'character', id))) {
      lines.push(`- characters의 ${id} — character/${id}.card 가 없다.`);
    }
  }

  const location: string | undefined = scene.location;

  if (
    location !== undefined &&
    !(await hasCardOfKind(cards, input.workspaceRoot, 'background', location))
  ) {
    lines.push(`- location의 ${location} — background/${location}.card 가 없다.`);
  }

  return lines;
}

async function checkCardRelations(
  input: StudioCardToolResolverInput,
  cards: CardReader,
): Promise<string[]> {
  const card: StoryboardCard = parseCard(input.baseline);
  const lines: string[] = [];

  if (isBackgroundCard(card)) {
    for (const id of card.characterIds) {
      if (!(await hasCardOfKind(cards, input.workspaceRoot, 'character', id))) {
        lines.push(`- characterIds의 ${id} — character/${id}.card 가 없다.`);
      }
    }

    return lines;
  }

  for (const relation of card.relations ?? []) {
    const target: StoryboardCard | undefined = isSafeStudioEntityKey(relation.target)
      ? (await cards.read(input.workspaceRoot, relation.target))?.card
      : undefined;

    if (target === undefined || isBackgroundCard(target)) {
      lines.push(
        `- 관계 ${relation.target}(${relation.type}) — character/${relation.target}.card 가 없다.`,
      );
      continue;
    }

    if (!(target.relations ?? []).some((back) => back.target === card.id)) {
      lines.push(
        `- 관계 ${relation.target}(${relation.type}) — 상대 카드에는 ${card.id} 방향 관계가 없다(일방향).`,
      );
    }
  }

  return lines;
}

async function hasCardOfKind(
  cards: CardReader,
  workspaceRoot: vscode.Uri,
  kind: 'character' | 'background',
  id: string,
): Promise<boolean> {
  if (!isSafeStudioEntityKey(id)) {
    return false;
  }

  const reading: Awaited<ReturnType<CardReader['read']>> = await cards.read(workspaceRoot, id);
  return reading?.category === kind;
}

function describeCollectProposal(proposal: CardCollectProposal): string {
  const sources: string =
    proposal.sourceScenes.length > 0 ? ` (출처: ${proposal.sourceScenes.join(', ')})` : '';

  switch (proposal.kind) {
    case 'attribute':
      return `- 속성 ${proposal.key}: ${proposal.value}${sources}`;
    case 'relation':
      return `- 관계 ${proposal.target}: ${proposal.type}${sources}`;
    case 'relationSpeech':
      return `- 말투 ${proposal.target}: ${proposal.speech}${sources}`;
    case 'arc':
      return `- 아크: ${proposal.summary}${sources}`;
    case 'scalar':
      return `- ${proposal.field}: ${proposal.after}${sources}`;
    default:
      return `- ${proposal.kind}: ${proposal.value}${sources}`;
  }
}

export class StudioCardInvokeResolver {
  public constructor(
    private readonly deps: StudioCardToolResolverDependencies,
    private readonly input: StudioCardToolResolverInput,
  ) {}

  public readonly resolve = async (request: StudioAgentInvokeRequest): Promise<string> => {
    try {
      switch (request.tool) {
        case 'collectFromDrafts':
          return await this.runCollect();
        case 'cardAudit':
          return await this.runAudit();
        case 'relationCheck':
          return await runRelationCheck(this.input, this.deps.cards);
        default:
          return `[도구 실패: ${request.tool}] 이 대화에서는 쓸 수 없는 도구다.`;
      }
    } catch (error) {
      this.deps.logger.warn(`Studio 카드 도구 실행 실패(${request.tool}): ${String(error)}`);
      return `[도구 실패: ${request.tool}] 실행 중 오류가 나서 결과를 얻지 못했다. 도구 없이 판단하라.`;
    }
  };

  private async runCollect(): Promise<string> {
    if (this.input.entity.kind === 'scene') {
      return '[도구 실패: collectFromDrafts] 씬 대화에서는 쓸 수 없는 도구다.';
    }

    let card: StoryboardCard;

    try {
      card = parseCard(this.input.baseline);
    } catch {
      return '[도구 실패: collectFromDrafts] 카드를 읽지 못해 수집할 수 없었다.';
    }

    const proposals: CardCollectProposal[] = await this.deps.cards.collectProposals({
      workspaceRoot: this.input.workspaceRoot,
      card,
    });

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

  private async runAudit(): Promise<string> {
    const verdict: StudioValidationVerdict = await this.deps.aiGateway
      .createService(this.input.workspaceRoot)
      .auditStudioEntity(
        {
          entityLabel: this.input.entityLabel,
          cardText: this.input.baseline,
          context: this.input.context,
        },
        { providerId: this.deps.aiGateway.getTaskProvider('studioValidation') },
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
}
