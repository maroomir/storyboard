import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildInstallSteps,
  runInstallSteps,
  waitForStorygramOnline,
} from '../../../../src/infrastructure/storygram/storygramInstaller';

describe('buildInstallSteps', () => {
  it('skips npm install when node_modules is already present', () => {
    const steps = buildInstallSteps({ repoRoot: '/repo', hasNodeModules: true });

    expect(steps.map((step) => step.title)).toEqual(['봇 빌드', '자동 시작 등록']);
    expect(steps[0]).toMatchObject({ command: 'npm', args: ['run', 'bot:build'] });
    expect(steps[1]?.command).toBe(join('/repo', 'apps', 'bot', 'scripts', 'install-launchd.sh'));
  });

  it('installs dependencies first when node_modules is missing', () => {
    const steps = buildInstallSteps({ repoRoot: '/repo', hasNodeModules: false });

    expect(steps.map((step) => step.title)).toEqual(['의존성 설치', '봇 빌드', '자동 시작 등록']);
    expect(steps[0]).toMatchObject({ command: 'npm', args: ['install'] });
  });

  it('never runs a step through a shell string', () => {
    const steps = buildInstallSteps({ repoRoot: '/repo with space', hasNodeModules: false });

    for (const step of steps) {
      expect(step.command).not.toContain('&&');
      expect(step.args.every((arg) => !arg.includes('&&'))).toBe(true);
    }
  });
});

describe('runInstallSteps', () => {
  const steps = [
    { title: '봇 빌드', command: 'npm', args: ['run', 'bot:build'] },
    { title: '자동 시작 등록', command: '/repo/install.sh', args: [] },
  ];

  it('runs every step in order from the repo root and reports success', async () => {
    const execFileFn = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });
    const started: string[] = [];

    const result = await runInstallSteps('/repo', steps, {
      execFileFn,
      onStepStart: (step): void => started.push(step.title),
    });

    expect(result.ok).toBe(true);
    expect(started).toEqual(['봇 빌드', '자동 시작 등록']);
    expect(execFileFn).toHaveBeenNthCalledWith(1, 'npm', ['run', 'bot:build'], { cwd: '/repo' });
    expect(execFileFn).toHaveBeenNthCalledWith(2, '/repo/install.sh', [], { cwd: '/repo' });
  });

  it('stops at the first failing step and names it with the captured output', async () => {
    const execFileFn = vi
      .fn()
      .mockRejectedValueOnce({ stdout: '', stderr: 'build broke', message: 'exit 1' });

    const result = await runInstallSteps('/repo', steps, { execFileFn });

    expect(result).toMatchObject({ ok: false, failedStep: '봇 빌드' });
    expect(result.output).toContain('build broke');
    expect(execFileFn).toHaveBeenCalledTimes(1);
  });
});

describe('waitForStorygramOnline', () => {
  it('returns true as soon as the check reports online, without sleeping first', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue('online');

    const online = await waitForStorygramOnline({
      check,
      isOnline: (value) => value === 'online',
      attempts: 5,
      delayMs: 10,
      sleep,
    });

    expect(online).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries with a delay between attempts and succeeds late', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const check = vi
      .fn()
      .mockResolvedValueOnce('offline')
      .mockResolvedValueOnce('offline')
      .mockResolvedValue('online');

    const online = await waitForStorygramOnline({
      check,
      isOnline: (value) => value === 'online',
      attempts: 5,
      delayMs: 10,
      sleep,
    });

    expect(online).toBe(true);
    expect(check).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('gives up after the attempt budget', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue('offline');

    const online = await waitForStorygramOnline({
      check,
      isOnline: (value) => value === 'online',
      attempts: 3,
      delayMs: 10,
      sleep,
    });

    expect(online).toBe(false);
    expect(check).toHaveBeenCalledTimes(3);
  });
});
