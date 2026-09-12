import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigBridge, OllamaProvider, storyboardModelCatalog } from '@storyboard/story-ai';
import type { OllamaClientLike, StoryboardConfigurationLike } from '@storyboard/story-ai';
import { chooseCostAxis } from '@storyboard/story-sim';

import { commands } from '../src/commands/index';
import { createCliContainer } from '../src/container';

// 로컬 LLM 경로. 요금이 0이고 모델 목록이 기계마다 다르며, 문맥이 조용히 잘리는 것이 가장 위험하다.

let home: string;
let workspace: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function container() {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '9.9.9',
  });
}

async function configSet(key: string, value: string) {
  return await commands['config set']?.({
    container: container(),
    args: { path: ['config', 'set'], flags: { global: true }, positionals: [key, value] },
  });
}

function storedModel(): string | undefined {
  return container().configBridge.getProviderConfig('ollama').model;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sim-local-home-'));
  process.env.STORYBOARD_HOME = home;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'ollama' }));
  workspace = mkdtempSync(join(tmpdir(), 'sim-local-ws-'));
});

afterEach(() => {
  delete process.env.STORYBOARD_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('local model names', () => {
  // 로컬은 받아 둔 모델이 기계마다 다르다. 카탈로그를 강제하면 이미 가진 모델을 못 쓴다.
  it('accepts an ollama model the catalog never heard of', async () => {
    const outcome = await configSet('providers.ollama.model', 'qwen3:30b-a3b');

    expect(outcome?.ok).toBe(true);
    expect(storedModel()).toBe('qwen3:30b-a3b');
  });

  it('still refuses an unknown model on a metered provider', async () => {
    const outcome = await configSet('providers.claude.model', 'claude-imaginary');

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('없는 모델');
  });

  it('suggests models that fit a desktop card', () => {
    const ids = storyboardModelCatalog.ollama.map((entry) => entry.id);

    expect(ids).toContain('qwen3:8b');
    expect(ids).toContain('gemma3:12b');
  });
});

describe('context window', () => {
  function bridgeFor(values: Map<string, unknown>): ConfigBridge {
    return new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike =>
        ({
          get: <T,>(key: string, fallback: T): T => (values.get(key) as T) ?? fallback,
        }) as StoryboardConfigurationLike,
    });
  }

  it('is absent until the machine says how much it has', () => {
    expect(bridgeFor(new Map()).getProviderConfig('ollama').contextTokens).toBeUndefined();
  });

  it('reads a positive value and ignores a nonsense one', () => {
    expect(
      bridgeFor(new Map([['providers.ollama.contextTokens', 32768]])).getProviderConfig('ollama')
        .contextTokens,
    ).toBe(32768);
    expect(
      bridgeFor(new Map([['providers.ollama.contextTokens', 0]])).getProviderConfig('ollama')
        .contextTokens,
    ).toBeUndefined();
  });

  it('refuses a context that is not a positive integer', async () => {
    expect((await configSet('providers.ollama.contextTokens', '-1'))?.ok).toBe(false);
    expect((await configSet('providers.ollama.contextTokens', '32768'))?.ok).toBe(true);
  });

  it('is only an ollama setting', async () => {
    const outcome = await configSet('providers.claude.contextTokens', '32768');

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('ollama');
  });

  // NOTE: 이것이 조용한 실패다. num_ctx 를 안 보내면 ollama 가 모델 기본 문맥을 쓰고, 8화까지
  // 누적한 프롬프트의 앞부분을 오류 없이 버린다. 그러면 후반 독자가 앞을 못 읽은 채 판정한다.
  it('sends the window to ollama so a long prompt is not silently truncated', async () => {
    const sent: unknown[] = [];
    const client: OllamaClientLike = {
      get: async () => ({}),
      post: async (_path, body) => {
        sent.push(body);
        return { message: { content: '초안' }, prompt_eval_count: 10, eval_count: 5 };
      },
    };

    await new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3:8b',
      contextTokens: 32768,
      createClient: () => client,
    }).generate({ taskName: 'sceneSkeleton', messages: [{ role: 'user', content: '씬' }] });

    expect(sent[0]).toMatchObject({ options: { num_ctx: 32768 } });
  });

  it('leaves the window to ollama when nobody set one', async () => {
    const sent: Record<string, unknown>[] = [];
    const client: OllamaClientLike = {
      get: async () => ({}),
      post: async (_path, body) => {
        sent.push(body as unknown as Record<string, unknown>);
        return { message: { content: '초안' } };
      },
    };

    await new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3:8b',
      createClient: () => client,
    }).generate({ taskName: 'sceneSkeleton', messages: [{ role: 'user', content: '씬' }] });

    expect((sent[0]?.options as Record<string, unknown>)['num_ctx']).toBeUndefined();
  });
});

describe('cost axis', () => {
  // 로컬 모델은 요금이 0이라 금액으로는 모든 지점이 같아진다. 그때 아까운 것은 토큰과 시간이다.
  it('falls back to tokens when nothing was billed', () => {
    expect(chooseCostAxis(0)).toBe('tokens');
    expect(chooseCostAxis(undefined)).toBe('tokens');
  });

  it('stays on dollars once something was', () => {
    expect(chooseCostAxis(0.42)).toBe('usd');
  });
});
