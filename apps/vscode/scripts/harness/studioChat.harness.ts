import nodeFs from 'node:fs/promises';

import * as vscode from 'vscode';
import { test } from 'vitest';

import { StoryboardAiService } from '@storyboard/story-ai';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { AiGenerateResponse, AiProvider } from '@storyboard/story-model';

import { StudioChatUseCase, type StudioChatRequest } from '@storyboard/story-engine';
import type { AiGateway } from '@storyboard/story-engine';
import { StudioFollowUpRepository } from '@storyboard/story-engine';
import { createStudioProposalRpcHandlers } from '@/presentation/messaging/studioProposalRpcHandlers';
import { createStudioInvokeResolver } from '@/presentation/messaging/studioToolResolver';
import type { StudioToolDiagnostics } from '@/presentation/providers/studioToolDiagnostics';
import {
  readStudioEntityContext,
  resolveStudioFollowUps,
  resolveStudioLookups,
  type StudioSceneFocus,
} from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { StudioChatTurn, StudioEntity } from '@storyboard/story-engine';

import { createUsageSummary } from './usageSummary';
import {
  createHarnessProvider,
  defaultHarnessModel,
  resolveHarnessProviderId,
} from './harnessProvider';

// NOTE: Diagnostic — drives the REAL Studio chat agent and the REAL apply path against a real
// workspace and a real CLI provider, so the prompt contract (say/ask/propose/lookup, follow-ups,
// field limits), the baseline guard and the writes are verified against a model rather than a stub.
// It WRITES to the workspace; run it on a git-clean tree and read the result with `git diff`.
const workspace = process.env.STUDIO_WS ?? process.env.SCENE_WS ?? '';
const providerId = resolveHarnessProviderId(
  process.env.STUDIO_PROVIDER ?? process.env.SCENE_PROVIDER,
);
const model = process.env.STUDIO_MODEL ?? process.env.SCENE_MODEL ?? defaultHarnessModel(providerId);
const onlyScenario = process.env.STUDIO_CASE;
const applyProposals = process.env.STUDIO_APPLY !== '0';

interface Scenario {
  readonly name: string;
  readonly entity: StudioEntity;
  readonly sceneFocus: StudioSceneFocus;
  readonly instruction: string;
  readonly history?: readonly StudioChatTurn[];
  readonly expectation: string;
}

const scenarios: readonly Scenario[] = [
  {
    name: 'vague-card',
    entity: { kind: 'character', key: 'seoha' },
    sceneFocus: 'draft',
    instruction: '서하를 좀 더 입체적으로 만들어줘',
    expectation: '모호한 지시 → ask 로 되물어야 한다',
  },
  {
    name: 'clear-card',
    entity: { kind: 'character', key: 'seoha' },
    sceneFocus: 'draft',
    instruction:
      '서하가 어릴 때 물에 빠진 적이 있어서 비 오는 날이면 손이 떨린다는 특성을 traits 에 더해줘',
    expectation: '명확한 지시 → propose(card) + 정합성 판정',
  },
  {
    name: 'ripple-background',
    entity: { kind: 'background', key: 'sugildang' },
    sceneFocus: 'draft',
    instruction:
      '기억을 담는 유리병 색을 푸른색에서 호박색으로 바꿔줘. 세공소의 모든 병이 호박빛이야.',
    expectation: 'propose(card) + followUps 로 영향받는 인물·씬을 지목해야 한다',
  },
  {
    name: 'arc',
    entity: { kind: 'character', key: 'seoha' },
    sceneFocus: 'draft',
    instruction:
      '서하가 이야기를 거치며 어떻게 변하는지 인물 카드에 단계별로 정리해줘. 상태 필드는 건드리지 말고.',
    expectation: 'propose(card) — arc 필드에 객체 배열로 써야 한다',
  },
  {
    name: 'scene-card',
    entity: { kind: 'scene', key: '01-selling-the-first-memory' },
    sceneFocus: 'card',
    instruction: '이 씬의 갈등을 더 선명하게 정리해줘',
    expectation: 'propose(card) — 서술 필드만 건드려야 한다',
  },
  {
    name: 'scene-card-blocked',
    entity: { kind: 'scene', key: '01-selling-the-first-memory' },
    sceneFocus: 'card',
    instruction: '이 씬 등장인물에 junhee 를 추가해줘',
    expectation: '구조 필드는 막혀 있으므로 say 로 거절 안내해야 한다',
  },
  {
    name: 'draft-continuity-tool',
    entity: { kind: 'scene', key: '01-selling-the-first-memory' },
    sceneFocus: 'draft',
    instruction: '이 초안이 카드·설정과 어긋나는 부분이 있는지 검사해줘',
    expectation: 'invoke(continuityCheck) → say 로 결과를 보고해야 한다',
  },
  {
    name: 'draft-expand-tool',
    entity: { kind: 'scene', key: '01-selling-the-first-memory' },
    sceneFocus: 'draft',
    instruction: '도입부 첫 문단이 너무 건조해. 도구를 써서 더 길게 풀어 쓴 다음 다듬어서 제안해줘',
    expectation: 'invoke(expand) → 초벌을 다듬어 propose(draft) 해야 한다',
  },
  {
    name: 'draft-section',
    entity: { kind: 'scene', key: '01-selling-the-first-memory' },
    sceneFocus: 'draft',
    instruction: '도입부 첫 문단을 비 소리가 더 도드라지게 고쳐줘',
    expectation: 'propose(draft) — 본문 일부 구간만 교체해야 한다',
  },
];

function backVscodeFsWithDisk(): void {
  const fsPathOf = (uri: unknown): string => String((uri as { fsPath: string }).fsPath);

  vscode.workspace.fs.readFile = async (uri): Promise<Uint8Array> =>
    new Uint8Array(await nodeFs.readFile(fsPathOf(uri)));

  vscode.workspace.fs.stat = async (uri): Promise<{ type: 1; mtime: number }> => {
    const stat = await nodeFs.stat(fsPathOf(uri));
    return { type: 1, mtime: stat.mtimeMs };
  };

  vscode.workspace.fs.readDirectory = async (uri): Promise<Array<[string, number]>> => {
    const entries = await nodeFs.readdir(fsPathOf(uri), { withFileTypes: true });
    return entries.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
  };

  vscode.workspace.fs.writeFile = async (uri, content): Promise<void> => {
    await nodeFs.writeFile(fsPathOf(uri), content);
  };

  vscode.workspace.fs.createDirectory = async (uri): Promise<void> => {
    await nodeFs.mkdir(fsPathOf(uri), { recursive: true });
  };
}

function createRegistry(provider: AiProvider): AiProviderRegistry {
  const registry = {
    generate: async (request: unknown): Promise<AiGenerateResponse> => {
      const response = await provider.generate(request as never);
      if (process.env.STUDIO_RAW === '1') {
        console.log(`\n----- raw response -----\n${response.text}\n------------------------`);
      }
      return response;
    },
    generateWithProvider: (_id: unknown, request: unknown): Promise<AiGenerateResponse> =>
      provider.generate(request as never),
    getTaskProvider: (): string => providerId,
    getTaskAiConfig: (): { readonly providerId: string; readonly model: string } => ({
      providerId,
      model,
    }),
  };

  return registry as unknown as AiProviderRegistry;
}

const harnessLogger = {
  warn: (message: string): void => console.log(`[warn] ${message}`),
  info: (): void => undefined,
} as unknown as IStoryboardLogger;

function createGateway(
  provider: AiProvider,
  onUsage: ReturnType<typeof createUsageSummary>['onUsage'],
): AiGateway {
  const service = new StoryboardAiService(createRegistry(provider), { onUsage });

  return {
    createService: () => service,
    getTaskProvider: () => providerId,
  } as unknown as AiGateway;
}

const harnessDiagnostics = {
  publishContinuity: async (_uri: unknown, issues: readonly unknown[]): Promise<void> => {
    console.log(`  [diagnostics] continuity ${issues.length}건 게시`);
  },
  publishGrammar: async (_uri: unknown, issues: readonly unknown[]): Promise<void> => {
    console.log(`  [diagnostics] grammar ${issues.length}건 게시`);
  },
} as unknown as StudioToolDiagnostics;

function describeTurn(turn: StudioChatTurn): string {
  if (turn.role === 'user') {
    return `user: ${turn.text}`;
  }

  switch (turn.kind) {
    case 'say':
      return [`say: ${turn.message}`, describeFollowUps(turn.followUps)].filter(Boolean).join('\n');
    case 'ask':
      return `ask: ${turn.question}\n  options: ${turn.options.join(' | ') || '(없음)'}`;
    case 'result':
      return `result: ${turn.message}`;
    case 'proposal':
      return [
        `propose(${turn.patch.target}) → ${turn.targetFile}`,
        `  summary: ${turn.summary}`,
        turn.message ? `  message: ${turn.message}` : '',
        `  validation: ${turn.validation.state}${turn.validation.warnings
          .map(
            (warning) =>
              `\n    ⚠ ${warning.message}${warning.source ? ` (${warning.source})` : ''}`,
          )
          .join('')}`,
        describePatch(turn),
        describeFollowUps(turn.followUps),
      ]
        .filter(Boolean)
        .join('\n');
  }
}

function describePatch(turn: Extract<StudioChatTurn, { kind: 'proposal' }>): string {
  if (turn.patch.target === 'card') {
    return turn.patch.changes
      .map(
        (change) =>
          `  field ${change.field} = ${
            Array.isArray(change.value)
              ? `[${change.value.map(describeCardEntry).join(' / ')}]`
              : String(change.value)
          }`,
      )
      .join('\n');
  }

  return turn.patch.replacements
    .map(
      (replacement) =>
        `  [${replacement.startOffset}-${replacement.endOffset}] → ${replacement.newText.slice(0, 120)}${
          replacement.newText.length > 120 ? '…' : ''
        }`,
    )
    .join('\n');
}

function describeCardEntry(entry: string | Readonly<Record<string, string>>): string {
  return typeof entry === 'string'
    ? entry
    : Object.entries(entry)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
}

function describeFollowUps(
  followUps:
    | readonly { kind: string; key: string; reason: string; targetFile: string }[]
    | undefined,
): string {
  if (!followUps || followUps.length === 0) {
    return '';
  }

  return [
    '  followUps:',
    ...followUps.map((followUp) => `    → ${followUp.targetFile}: ${followUp.reason}`),
  ].join('\n');
}

const followUpRepository = new StudioFollowUpRepository();

// NOTE: the real apply handler is driven here (not applyStudioPatch directly) so the baseline guard,
// the draft frontmatter rewrite and the follow-up bookkeeping are all exercised.
const proposalHandlers = createStudioProposalRpcHandlers({
  reviewService: { showDiffs: async (): Promise<void> => undefined } as never,
  followUpRepository,
  getProjectRoot: async () => vscode.Uri.file(workspace) as never,
  createFollowUpId: () => `harness-${Math.random().toString(36).slice(2, 10)}`,
});

async function applyProposal(entity: StudioEntity, turn: StudioChatTurn): Promise<string> {
  if (turn.role !== 'assistant' || turn.kind !== 'proposal') {
    return '';
  }

  const handler = proposalHandlers['studio.proposal.apply'];
  const response = (await handler({ entity, turn } as never, {} as never)) as {
    status: string;
    message: string;
  };

  return `  apply(${response.status}): ${response.message}`;
}

test('studio chat against a real workspace', async () => {
  if (!workspace) {
    throw new Error('STUDIO_WS 를 지정하세요.');
  }

  backVscodeFsWithDisk();

  const provider = await createHarnessProvider(providerId, model);

  // NOTE: STUDIO_SEED runs only the card-seed extraction (kind/name/roman id) and exits — the
  // cheapest way to watch the /create wizard's one AI call against a real provider.
  if (process.env.STUDIO_SEED) {
    const usage = createUsageSummary();
    const seed = await (
      createGateway(provider, usage.onUsage).createService(vscode.Uri.file(workspace) as never) as never as {
        extractStudioCardSeed: (description: string) => Promise<unknown>;
      }
    ).extractStudioCardSeed(process.env.STUDIO_SEED);
    console.log(`seed: ${JSON.stringify(seed)}`);
    usage.print();
    return;
  }

  const root = vscode.Uri.file(workspace) as never;
  const usage = createUsageSummary();
  const gateway = createGateway(provider, usage.onUsage);
  const useCase = new StudioChatUseCase(gateway, harnessLogger);
  const selected = onlyScenario
    ? scenarios.filter((scenario) => scenario.name === onlyScenario)
    : scenarios;

  try {
    for (const scenario of selected) {
      const context = await readStudioEntityContext(root, scenario.entity, scenario.sceneFocus);

      if (!context) {
        console.log(`\n### ${scenario.name} — 대상을 찾을 수 없음`);
        continue;
      }

      console.log(`\n${'='.repeat(78)}`);
      console.log(`### ${scenario.name} — ${context.targetFile}`);
      console.log(`기대: ${scenario.expectation}`);
      console.log(`지시: ${scenario.instruction}`);
      console.log('-'.repeat(78));

      const request: StudioChatRequest = {
        workspaceRoot: root,
        entityContext: context,
        history: scenario.history ?? [],
        instruction: scenario.instruction,
        hasSelection: false,
        isValidationEnabled: true,
        resolveLookup: (requests) => resolveStudioLookups(root, requests),
        ...(context.patchTarget === 'draft' &&
        context.baseline !== undefined &&
        context.targetUri !== undefined
          ? {
              resolveInvoke: createStudioInvokeResolver(
                { aiGateway: gateway, logger: harnessLogger, diagnostics: harnessDiagnostics },
                {
                  workspaceRoot: root,
                  sceneStem: scenario.entity.key,
                  draftUri: context.targetUri as never,
                  baseline: context.baseline,
                },
              ),
            }
          : {}),
        resolveFollowUps: (followUps) => resolveStudioFollowUps(root, followUps),
        createTurnId: () => `${scenario.name}-${Math.random().toString(36).slice(2, 8)}`,
        onStage: (stage) => console.log(`  [${stage}]`),
      };

      const started = Date.now();
      const turns = await useCase.send(request);
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      for (const turn of turns) {
        console.log(describeTurn(turn));

        if (applyProposals) {
          const applied = await applyProposal(scenario.entity, turn);
          if (applied) {
            console.log(applied);
          }
        }
      }

      const waiting = await followUpRepository.list(root, scenario.entity);
      if (waiting.length > 0) {
        console.log(
          `  넘어온 작업 ${waiting.length}건: ${waiting.map((f) => f.reason).join(' / ')}`,
        );
      }

      console.log(`  (${elapsed}s)`);
    }
  } finally {
    usage.print();
  }
});
