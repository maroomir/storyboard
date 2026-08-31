import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

import { createStudioInvokeResolver } from '@/presentation/messaging/studioToolResolver';
import type {
  StudioInvokeResolverDependencies,
  StudioInvokeResolverInput,
} from '@/presentation/messaging/studioToolResolver';

const draftBody = '골목은 어둑했고, 세연은 유리병을 매만졌다.';
const baseline = [
  '---',
  'sceneStem: 01-intro',
  'format: novel',
  'generatedAt: "2026-08-06T09:00:00.000Z"',
  '---',
  draftBody,
].join('\n');

interface FakeService {
  readonly checkContinuity: ReturnType<typeof vi.fn>;
  readonly checkGrammar: ReturnType<typeof vi.fn>;
  readonly expandDraft: ReturnType<typeof vi.fn>;
  readonly condenseDraft: ReturnType<typeof vi.fn>;
  readonly augmentDraft: ReturnType<typeof vi.fn>;
}

function fakeService(): FakeService {
  return {
    checkContinuity: vi.fn(async () => []),
    checkGrammar: vi.fn(async () => []),
    expandDraft: vi.fn(async () => '길게 풀어 쓴 초벌'),
    condenseDraft: vi.fn(async () => '줄인 초벌'),
    augmentDraft: vi.fn(async () => '보충한 초벌'),
  };
}

function resolverWith(service: FakeService): {
  resolve: (request: unknown) => Promise<string>;
  diagnostics: {
    publishContinuity: ReturnType<typeof vi.fn>;
    publishGrammar: ReturnType<typeof vi.fn>;
  };
} {
  const diagnostics = {
    publishContinuity: vi.fn(async () => undefined),
    publishGrammar: vi.fn(async () => undefined),
  };

  const deps = {
    aiGateway: {
      createService: () => service,
      getTaskProvider: () => 'mock',
    },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    diagnostics,
  } as unknown as StudioInvokeResolverDependencies;

  const input: StudioInvokeResolverInput = {
    workspaceRoot: vscode.Uri.file('/workspace'),
    sceneStem: '01-intro',
    draftUri: vscode.Uri.file('/workspace/draft/01-intro.md'),
    baseline,
  };

  return {
    resolve: createStudioInvokeResolver(deps, input) as (request: unknown) => Promise<string>,
    diagnostics,
  };
}

describe('createStudioInvokeResolver', () => {
  it('reports grammar issues and publishes them to the editor', async () => {
    const service = fakeService();
    service.checkGrammar.mockResolvedValue([
      { start: 0, end: 3, original: '골목은', suggestion: '골목길은', reason: '어색한 조사' },
    ]);
    const { resolve, diagnostics } = resolverWith(service);

    const report = await resolve({ tool: 'grammarCheck' });

    expect(report).toContain('[도구 결과: grammarCheck] 문제 1건');
    expect(report).toContain('어색한 조사');
    expect(report).toContain('골목길은');
    expect(diagnostics.publishGrammar).toHaveBeenCalledTimes(1);
  });

  it('says the draft is clean when grammar finds nothing', async () => {
    const { resolve } = resolverWith(fakeService());

    await expect(resolve({ tool: 'grammarCheck' })).resolves.toContain('문제가 없다');
  });

  it('skips the continuity check when the scene context cannot be read', async () => {
    const service = fakeService();
    const { resolve } = resolverWith(service);

    const report = await resolve({ tool: 'continuityCheck' });

    expect(report).toContain('검사를 건너뛰었다');
    expect(service.checkContinuity).not.toHaveBeenCalled();
  });

  it('expands a span whose anchor matches the body', async () => {
    const service = fakeService();
    const { resolve } = resolverWith(service);

    const report = await resolve({
      tool: 'expand',
      span: { startOffset: 0, endOffset: 8, oldText: draftBody.slice(0, 8) },
    });

    expect(report).toContain('[도구 결과: expand]');
    expect(report).toContain('길게 풀어 쓴 초벌');
    expect(service.expandDraft).toHaveBeenCalledWith(
      draftBody.slice(0, 8),
      {},
      expect.objectContaining({ providerId: 'mock' }),
    );
  });

  it('refuses a span whose anchor drifted off the body', async () => {
    const service = fakeService();
    const { resolve } = resolverWith(service);

    const report = await resolve({
      tool: 'expand',
      span: { startOffset: 0, endOffset: 8, oldText: '다른 문장이다' },
    });

    expect(report).toContain('[도구 실패: expand]');
    expect(service.expandDraft).not.toHaveBeenCalled();
  });

  it('condenses with a shorter target even when the scene context is missing', async () => {
    const service = fakeService();
    const { resolve } = resolverWith(service);

    const report = await resolve({
      tool: 'condense',
      span: { startOffset: 0, endOffset: draftBody.length, oldText: draftBody },
    });

    expect(report).toContain('줄인 초벌');
    const input = service.condenseDraft.mock.calls[0]?.[0] as { targetLength: number };
    expect(input.targetLength).toBeLessThan(draftBody.length);
  });

  it('fails augment without a scene context instead of inventing cards', async () => {
    const service = fakeService();
    const { resolve } = resolverWith(service);

    const report = await resolve({
      tool: 'augment',
      span: { startOffset: 0, endOffset: 4, oldText: draftBody.slice(0, 4) },
      instruction: '배경 묘사 보충',
    });

    expect(report).toContain('[도구 실패: augment]');
    expect(service.augmentDraft).not.toHaveBeenCalled();
  });

  it('degrades to a failure remark when the provider call throws', async () => {
    const service = fakeService();
    service.checkGrammar.mockRejectedValue(new Error('provider down'));
    const { resolve } = resolverWith(service);

    await expect(resolve({ tool: 'grammarCheck' })).resolves.toContain('[도구 실패: grammarCheck]');
  });
});
