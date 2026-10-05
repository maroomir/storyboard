import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

import {
  AiProviderError,
  aiProviderIds,
  listAvailableProviderIds,
  listSelectableProviderIds,
  type AiStreamChunk,
} from '@storyboard/story-model';
import {
  ClaudeCodeProvider,
  ConfigBridge,
  NodeCliRunner,
  SecretStore,
  computeCostUsd,
  createAiProviderRegistry,
  splitCliPrompt,
  type CliRunRequest,
  type CliRunResult,
  type ICliRunner,
} from '@storyboard/story-ai';
import { ConfigFileError, createFileConfiguration } from '@storyboard/story-config';

import { availableProviderIds } from '@/adapters/availableProviders';
import { commandCatalog } from '@/commands/catalog';

const enabledKey = 'providers.claude-code.enabled';
const acknowledgedKey = 'providers.claude-code.riskAcknowledged';

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value));
}

function createHome(
  home: Record<string, unknown>,
  workspace?: Record<string, unknown>,
): { readonly configBridge: ConfigBridge; readonly userConfigFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'storyboard-hidden-'));
  const userConfigFile = join(directory, 'config.json');
  const workspaceConfigFile = join(directory, 'workspace.json');

  writeJson(userConfigFile, home);
  if (workspace !== undefined) {
    writeJson(workspaceConfigFile, workspace);
  }

  const configuration = createFileConfiguration({
    userConfigFile,
    ...(workspace === undefined ? {} : { workspaceConfigFile }),
  });

  return {
    configBridge: new ConfigBridge({ getConfiguration: () => configuration }),
    userConfigFile,
  };
}

function resultLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    api_error_status: null,
    usage: { input_tokens: 2, output_tokens: 129, cache_creation_input_tokens: 543 },
    ...fields,
  });
}

function deltaLine(text: string): string {
  return JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  });
}

class FakeRunner implements ICliRunner {
  public readonly requests: CliRunRequest[] = [];
  public runningCount = 0;
  public maxRunningCount = 0;

  public constructor(
    private readonly lines: readonly string[],
    private readonly outcome: CliRunResult = { exitCode: 0, stderr: '' },
  ) {}

  public async run(request: CliRunRequest): Promise<CliRunResult> {
    this.requests.push(request);
    this.runningCount += 1;
    this.maxRunningCount = Math.max(this.maxRunningCount, this.runningCount);
    await new Promise((resolve) => setTimeout(resolve, 5));

    for (const line of this.lines) {
      request.onStdoutLine?.(line);
    }

    this.runningCount -= 1;
    return this.outcome;
  }
}

const userRequest = {
  taskName: 'sceneDraft',
  messages: [
    { role: 'system', content: '너는 소설가다.' },
    { role: 'user', content: '비 오는 골목을 묘사해.' },
  ],
} as const;

function createProvider(runner: ICliRunner): ClaudeCodeProvider {
  return new ClaudeCodeProvider({ model: 'claude-sonnet-5', runner });
}

async function expectProviderError(
  promise: Promise<unknown>,
  code: string,
): Promise<AiProviderError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(AiProviderError);
  expect((error as AiProviderError).code).toBe(code);
  return error as AiProviderError;
}

describe('the hidden subscription provider: who can see it', () => {
  it('is absent from every list a person is shown until it is switched on', () => {
    expect(aiProviderIds).toContain('claude-code');
    expect(listAvailableProviderIds()).not.toContain('claude-code');
    expect(listSelectableProviderIds()).not.toContain('claude-code');
    expect(listAvailableProviderIds(['claude-code'])).toContain('claude-code');
    expect(listSelectableProviderIds(undefined, ['claude-code'])).toContain('claude-code');
  });

  it('reads as no provider chosen while the switch is off', () => {
    const { configBridge } = createHome({});

    expect(configBridge.isProviderAvailable('claude-code')).toBe(false);
    expect(configBridge.getAvailableProviderIds()).not.toContain('claude-code');
  });

  it('rejects the name in a config file while the switch is off, as it did before', () => {
    const { configBridge } = createHome({ 'ai.provider.default': 'claude-code' });

    expect(() => configBridge.isDefaultProviderConfigured()).toThrow(ConfigFileError);
  });

  it('accepts the name once the home file switches it on', () => {
    const { configBridge } = createHome({
      [enabledKey]: true,
      'ai.provider.default': 'claude-code',
    });

    expect(configBridge.isDefaultProviderConfigured()).toBe(true);
    expect(configBridge.getDefaultProvider()).toBe('claude-code');
    expect(configBridge.getTaskAiConfig('sceneDraft')).toEqual({
      providerId: 'claude-code',
      model: 'claude-sonnet-5',
    });
  });

  it('never lets a workspace file switch it on or choose the executable', () => {
    const { configBridge } = createHome(
      {},
      { [enabledKey]: true, [acknowledgedKey]: true, 'providers.claude-code.command': '/tmp/evil' },
    );

    expect(configBridge.isHiddenProviderEnabled('claude-code')).toBe(false);
    expect(configBridge.isHiddenProviderRiskAcknowledged('claude-code')).toBe(false);
    expect(configBridge.getCliProviderConfig('claude-code')).toEqual({});
  });

  it('reads the executable and the time limit from the home file', () => {
    const { configBridge } = createHome({
      'providers.claude-code.command': '/opt/bin/claude',
      'providers.claude-code.timeoutMs': 1000,
    });

    expect(configBridge.getCliProviderConfig('claude-code')).toEqual({
      command: '/opt/bin/claude',
      timeoutMs: 1000,
    });
  });

  it('has no price, so its usage is unpriced rather than free', () => {
    expect(
      computeCostUsd({
        providerId: 'claude-code',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 1000, outputTokens: 1000 },
      }),
    ).toBeUndefined();
  });
});

describe('the hidden subscription provider: what the CLI names', () => {
  function homeEnvironment(home: Record<string, unknown>): NodeJS.ProcessEnv {
    const directory = mkdtempSync(join(tmpdir(), 'storyboard-hidden-home-'));
    writeJson(join(directory, 'config.json'), home);

    return { STORYBOARD_HOME: directory };
  }

  it('leaves the name out of what it lists and accepts while the switch is off', () => {
    expect(availableProviderIds(homeEnvironment({}))).not.toContain('claude-code');
    expect(availableProviderIds(homeEnvironment({ [enabledKey]: false }))).not.toContain(
      'claude-code',
    );
  });

  it('names it once the home file switches it on', () => {
    expect(availableProviderIds(homeEnvironment({ [enabledKey]: true }))).toContain('claude-code');
  });

  it('never mentions it in help or the catalog of flags', () => {
    expect(JSON.stringify(commandCatalog)).not.toMatch(/claude-code|구독/);
  });
});

describe('the hidden subscription provider: the registry gate', () => {
  function createRegistry(
    home: Record<string, unknown>,
    runner: ICliRunner,
    warnings: string[] = [],
  ) {
    const { configBridge } = createHome(home);

    return createAiProviderRegistry({
      configBridge,
      secretStore: new SecretStore({
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined,
      }),
      createCliRunner: () => runner,
      onRiskWarning: (message) => warnings.push(message),
    });
  }

  it('refuses it as an unknown provider while the switch is off', async () => {
    const runner = new FakeRunner([resultLine({ result: '글' })]);
    const registry = createRegistry({}, runner);

    const error = await expectProviderError(
      registry.generateWithProvider('claude-code', userRequest),
      'provider-not-enabled',
    );

    expect(error.message).toBe('알 수 없는 프로바이더: claude-code');
    expect(runner.requests).toHaveLength(0);
    expect((await registry.listProviders()).map((status) => status.providerId)).not.toContain(
      'claude-code',
    );
  });

  it('refuses to run until the risks were accepted', async () => {
    const runner = new FakeRunner([resultLine({ result: '글' })]);
    const registry = createRegistry({ [enabledKey]: true }, runner);

    await expectProviderError(
      registry.generateWithProvider('claude-code', userRequest),
      'risk-not-acknowledged',
    );
    expect(runner.requests).toHaveLength(0);
  });

  it('runs after acceptance and warns once per registry', async () => {
    const warnings: string[] = [];
    const runner = new FakeRunner([resultLine({ result: '글' })]);
    const registry = createRegistry(
      { [enabledKey]: true, [acknowledgedKey]: true },
      runner,
      warnings,
    );

    await registry.generateWithProvider('claude-code', userRequest);
    const response = await registry.generateWithProvider('claude-code', userRequest);

    expect(response.text).toBe('글');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('구독 한도');
  });
});

describe('the hidden subscription provider: the call', () => {
  it('sends the measured flags, the prompt on stdin and no API key', async () => {
    const runner = new FakeRunner([resultLine({ result: '빗물이 흘렀다.' })]);

    const response = await createProvider(runner).generate({
      ...userRequest,
      reasoningEffort: 'low',
    });
    const [request] = runner.requests;

    expect(request?.command).toBe('claude');
    expect(request?.args).toEqual([
      '-p',
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      'claude-sonnet-5',
      '--system-prompt',
      '너는 소설가다.',
      '--effort',
      'low',
    ]);
    expect(request?.args).not.toContain('--bare');
    expect(request?.stdin).toBe('비 오는 골목을 묘사해.');
    expect(request?.withoutEnvironment).toContain('ANTHROPIC_API_KEY');
    expect(request?.timeoutMs).toBe(600_000);
    expect(response).toEqual({
      providerId: 'claude-code',
      model: 'claude-sonnet-5',
      text: '빗물이 흘렀다.',
      // Cache tokens are folded into the input: with no price, tokens are the only measure.
      usage: { inputTokens: 545, outputTokens: 129 },
    });
  });

  it('writes a conversation out as a labelled transcript', () => {
    expect(
      splitCliPrompt([
        { role: 'user', content: '안녕' },
        { role: 'assistant', content: '네' },
        { role: 'user', content: '계속' },
      ]).prompt,
    ).toBe('[사용자]\n안녕\n\n[어시스턴트]\n네\n\n[사용자]\n계속');
  });

  it('streams text as it arrives and ends with the full response', async () => {
    const runner = new FakeRunner([
      deltaLine('빗물'),
      deltaLine('이 흘렀다.'),
      resultLine({ result: '빗물이 흘렀다.' }),
    ]);
    const chunks: AiStreamChunk[] = [];

    for await (const chunk of createProvider(runner).generateStream(userRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => (chunk.type === 'text-delta' ? chunk.delta : 'done'))).toEqual([
      '빗물',
      '이 흘렀다.',
      'done',
    ]);
  });

  it('marks a response cut at the output limit', async () => {
    const runner = new FakeRunner([resultLine({ result: '끊긴 글', stop_reason: 'max_tokens' })]);

    expect((await createProvider(runner).generate(userRequest)).isTruncated).toBe(true);
  });

  it('runs one child at a time however many calls arrive together', async () => {
    const runner = new FakeRunner([resultLine({ result: '글' })]);
    const provider = createProvider(runner);

    await Promise.all([1, 2, 3].map(() => provider.generate(userRequest)));

    expect(runner.requests).toHaveLength(3);
    expect(runner.maxRunningCount).toBe(1);
  });

  it('says the executable is missing', async () => {
    const runner = new FakeRunner([], {
      exitCode: null,
      stderr: 'spawn claude ENOENT',
      failure: 'not-found',
    });

    const error = await expectProviderError(
      createProvider(runner).generate(userRequest),
      'cli-not-found',
    );
    expect(error.message).toContain('providers.claude-code.command');
  });

  // Measured with --bare on 2.1.289: exit 1, subtype "success", is_error true.
  it('says the login was not found even though the subtype reads success', async () => {
    const runner = new FakeRunner(
      [resultLine({ is_error: true, result: 'Not logged in · Please run /login' })],
      { exitCode: 1, stderr: '' },
    );

    const error = await expectProviderError(
      createProvider(runner).generate(userRequest),
      'cli-not-logged-in',
    );
    expect(error.message).toContain('bare');
  });

  it('says the usage limit was reached and when it resets', async () => {
    const runner = new FakeRunner(
      [
        JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: { status: 'rejected', resetsAt: 1791216000 },
        }),
        resultLine({ is_error: true, result: 'Claude usage limit reached', api_error_status: 429 }),
      ],
      { exitCode: 1, stderr: '' },
    );

    const error = await expectProviderError(
      createProvider(runner).generate(userRequest),
      'cli-usage-limit',
    );
    expect(error.message).toContain('한도는');
  });

  it('says the call ran out of time', async () => {
    const runner = new FakeRunner([], { exitCode: null, stderr: '', failure: 'timeout' });

    await expectProviderError(createProvider(runner).generate(userRequest), 'cli-timeout');
  });

  it('fails on a non-zero exit with no result instead of returning empty text', async () => {
    const runner = new FakeRunner([], { exitCode: 1, stderr: 'boom' });

    const error = await expectProviderError(
      createProvider(runner).generate(userRequest),
      'generation-failed',
    );
    expect(error.message).toContain('boom');
  });

  it('fails on an error result even when the exit code is zero', async () => {
    const runner = new FakeRunner([
      resultLine({ is_error: true, result: 'model not found', api_error_status: 404 }),
    ]);

    await expectProviderError(createProvider(runner).generate(userRequest), 'generation-failed');
  });

  it('checks the login by asking the executable', async () => {
    await expect(
      createProvider(new FakeRunner(['{"loggedIn": true}'])).checkConnection(),
    ).resolves.toBe(true);
    await expectProviderError(
      createProvider(new FakeRunner(['{"loggedIn": false}'])).checkConnection(),
      'cli-not-logged-in',
    );
  });
});

describe('the Node CLI runner', () => {
  const runner = new NodeCliRunner();
  const base = { stdin: '', timeoutMs: 10_000, withoutEnvironment: [] as string[] };

  it('passes stdin through, reads stdout by line and withholds the named variables', async () => {
    process.env.STORYBOARD_TEST_SECRET = 'secret';
    process.env.STORYBOARD_TEST_KEPT = 'kept';
    const lines: string[] = [];

    const result = await runner.run({
      ...base,
      command: process.execPath,
      args: [
        '-e',
        'process.stdin.on("data", (d) => console.log(`in:${d}`)); process.stdin.on("end", () => console.log(`${process.env.STORYBOARD_TEST_SECRET}|${process.env.STORYBOARD_TEST_KEPT}`));',
      ],
      stdin: '프롬프트',
      withoutEnvironment: ['STORYBOARD_TEST_SECRET'],
      onStdoutLine: (line) => lines.push(line),
    });

    delete process.env.STORYBOARD_TEST_SECRET;
    delete process.env.STORYBOARD_TEST_KEPT;

    expect(result).toEqual({ exitCode: 0, stderr: '' });
    expect(lines).toEqual(['in:프롬프트', 'undefined|kept']);
  });

  it('reports a missing executable', async () => {
    const result = await runner.run({ ...base, command: 'storyboard-no-such-binary', args: [] });

    expect(result.failure).toBe('not-found');
  });

  it('kills a child that outlives its time limit', async () => {
    const result = await runner.run({
      ...base,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 100,
    });

    expect(result.failure).toBe('timeout');
  });

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // QA D1: a child that ignores SIGTERM kept the run (and the workspace lock) forever.
  it('ends a child that ignores SIGTERM within the grace period', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'storyboard-runner-')), 'child.pid');
    const started = Date.now();

    const result = await runner.run({
      ...base,
      command: process.execPath,
      args: [
        '-e',
        'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
        pidFile,
      ],
      timeoutMs: 300,
    });

    expect(result.failure).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(isAlive(Number(readFileSync(pidFile, 'utf8')))).toBe(false);
  }, 10_000);

  // QA D1: a wrapper script's own child held the stdout pipe, so `close` never came.
  it('ends the whole process group, grandchildren included', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'storyboard-runner-')), 'grandchild.pid');
    const grandchild = `"${process.execPath}" -e 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)' "${pidFile}"`;

    for (const ending of ['timeout', 'aborted'] as const) {
      const abort = new AbortController();
      if (ending === 'aborted') {
        setTimeout(() => abort.abort(), 300);
      }
      const started = Date.now();

      const result = await runner.run({
        ...base,
        command: '/bin/sh',
        args: ['-c', `${grandchild} & wait`],
        timeoutMs: ending === 'timeout' ? 300 : 60_000,
        signal: abort.signal,
      });

      expect(result.failure).toBe(ending);
      expect(Date.now() - started).toBeLessThan(6_000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(isAlive(Number(readFileSync(pidFile, 'utf8')))).toBe(false);
    }
  }, 20_000);

  // QA D2: a host killed by SIGTERM or SIGHUP left the child running. The CLI turns both into an
  // orderly exit (apps/cli/src/index.ts), which runs the runner's exit hook.
  it('takes its child group down when a host turns SIGTERM or SIGHUP into an exit', async () => {
    for (const [signal, exitCode] of [
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ] as const) {
      const directory = mkdtempSync(join(tmpdir(), 'storyboard-runner-'));
      const pidFile = join(directory, 'grandchild.pid');
      const runnerBundle = join(directory, 'runner.cjs');
      buildSync({
        entryPoints: [
          join(__dirname, '../../../packages/story-ai/src/ai/providers/nodeCliRunner.ts'),
        ],
        outfile: runnerBundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
      });
      const grandchild = `"${process.execPath}" -e 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)' "${pidFile}"`;
      const host = spawn(
        process.execPath,
        [
          '-e',
          `process.on(${JSON.stringify(signal)}, () => process.exit(${exitCode}));
           const { NodeCliRunner } = require(${JSON.stringify(runnerBundle)});
           void new NodeCliRunner().run({ command: '/bin/sh', args: ['-c', ${JSON.stringify(`${grandchild} & wait`)}],
             stdin: '', timeoutMs: 60000, withoutEnvironment: [] });
           setInterval(() => {}, 1000);`,
        ],
        { stdio: 'ignore' },
      );

      while (!existsSync(pidFile)) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      host.kill(signal);
      await new Promise((resolve) => host.once('exit', resolve));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(isAlive(Number(readFileSync(pidFile, 'utf8'))), signal).toBe(false);
    }
  }, 20_000);

  it('takes its child down when the host process exits mid-call', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'storyboard-runner-'));
    const pidFile = join(directory, 'child.pid');
    const runnerBundle = join(directory, 'runner.cjs');
    buildSync({
      entryPoints: [
        join(__dirname, '../../../packages/story-ai/src/ai/providers/nodeCliRunner.ts'),
      ],
      outfile: runnerBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    });
    const hostScript = `
      const { NodeCliRunner } = require(${JSON.stringify(runnerBundle)});
      void new NodeCliRunner().run({
        command: process.execPath,
        args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', ${JSON.stringify(pidFile)}],
        stdin: '', timeoutMs: 60000, withoutEnvironment: [],
      });
      const wait = setInterval(() => {
        if (require('node:fs').existsSync(${JSON.stringify(pidFile)})) { clearInterval(wait); process.exit(0); }
      }, 20);
    `;

    execFileSync(process.execPath, ['-e', hostScript], { stdio: 'ignore' });
    const childPid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it('kills the child when the caller aborts', async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);

    const result = await runner.run({
      ...base,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      signal: abort.signal,
    });

    expect(result.failure).toBe('aborted');
  });
});
