import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
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

// 심판은 생성과 같은 로컬 런타임에서 돈다. 가짜 ollama 를 세워 두고, 심판 호출이 정말 그 주소로
// 가는지와 num_ctx 가 실려 오는지를 본다. 둘 다 조용히 틀리는 종류다 — 주소가 기본값이면 그 기계에
// ollama 가 있는 한 연결은 되고, num_ctx 가 빠지면 8화 누적 프롬프트의 앞이 오류 없이 잘린다.
describe('the judge runs on the measured machine', () => {
  let stub: Server | undefined;
  let track: string | undefined;
  let bodies: Record<string, unknown>[] = [];

  afterEach(async () => {
    if (stub !== undefined) {
      await new Promise((resolve) => stub?.close(resolve));
      stub = undefined;
    }
    if (track !== undefined) {
      rmSync(track, { recursive: true, force: true });
      track = undefined;
    }
    bodies = [];
  });

  async function startStub(): Promise<string> {
    bodies = [];
    stub = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        bodies.push(body);
        const asked = JSON.stringify(body['messages']);
        // 관문이면 기호로, 읽기면 계속 읽겠다고 답한다.
        const text = asked.includes('줄을 세워라')
          ? JSON.stringify({ ranking: ['가', '나'] })
          : JSON.stringify({ engagement: 5, continueReading: true, reason: '이유', quote: '문' });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: { content: text }, prompt_eval_count: 1, eval_count: 1 }));
      });
    });

    await new Promise<void>((resolve) => stub?.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(stub?.address() as AddressInfo).port}`;
  }

  function trackRepo(baseUrl: string): string {
    track = mkdtempSync(join(tmpdir(), 'sim-judge-track-'));
    const genre = join(track, 'track', 'chain', 'thriller');
    mkdirSync(join(genre, 'scene'), { recursive: true });
    mkdirSync(join(genre, 'floor'), { recursive: true });
    writeFileSync(
      join(genre, 'scene', '01-a.card'),
      'type: scene\nid: 01-a\ntitle: 첫 씬\ntargetWordCount: 300\nsummary: 문을 연다.\n',
    );
    writeFileSync(join(genre, 'floor', '01-a.md'), '망가진 원고. 문. 문. 문.');
    writeFileSync(
      join(track, 'sim.config.json'),
      JSON.stringify({ ollama: { baseUrl, contextTokens: 32768 } }),
    );

    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: track });
    };
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'fixture');

    return track;
  }

  it('sends the judge to the address and window the sim profile named', async () => {
    const baseUrl = await startStub();
    const root = trackRepo(baseUrl);

    const outcome = await commands['sim run']?.({
      container: createCliContainer({
        workspacePath: root,
        logger: silentLogger,
        canPrompt: false,
        version: '9.9.9',
      }),
      args: {
        path: ['sim', 'run'],
        flags: {
          track: root,
          genre: 'thriller',
          provider: 'mock',
          judge: 'ollama',
          'judge-model': 'gemma3:12b',
          repeats: '1',
          out: join(root, 'results', 'runs.jsonl'),
          yes: true,
        },
        positionals: [],
      },
    });

    expect(outcome?.ok).toBe(true);
    // 심판이 기본 주소가 아니라 프로필이 가리킨 가짜 서버로 갔다.
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((body) => (body['options'] as Record<string, unknown>)['num_ctx'] === 32768)).toBe(true);
    expect(bodies.every((body) => body['model'] === 'gemma3:12b')).toBe(true);
  });
});
