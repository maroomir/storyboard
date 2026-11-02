import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedArguments } from '@/cliArguments';
import { findCommand } from '@/commands/index';
import { createCliContainer, type CliContainer } from '@/container';
import type { ChoiceRequest, IPrompter, TextRequest } from '@/adapters/prompter';

let home: string;
let workspace: string;
let previousHome: string | undefined;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

interface ScriptedPrompter extends IPrompter {
  readonly announced: string[];
  readonly titles: string[];
}

function scriptedPrompter(pickLabels: readonly string[], texts: readonly string[] = []): ScriptedPrompter {
  const picks: string[] = [...pickLabels];
  const answers: string[] = [...texts];
  const announced: string[] = [];
  const titles: string[] = [];

  return {
    shouldConfirmPaidRuns: false,
    announced,
    titles,
    announce: (line: string): void => void announced.push(line),
    askText: async (_request: TextRequest): Promise<string | undefined> => answers.shift(),
    choose: async <T>(request: ChoiceRequest<T>): Promise<T | undefined> => {
      titles.push(request.title);
      const wanted: string | undefined = picks.shift();
      const option = request.options.find((candidate) => candidate.label.startsWith(wanted ?? '\u0000'));
      return option?.value;
    },
  };
}

function container(prompter?: IPrompter): CliContainer {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: prompter !== undefined,
    version: '0.0.0',
    ...(prompter === undefined ? {} : { prompter }),
  });
}

function args(path: string[], flags: Record<string, string | boolean> = {}, positionals: string[] = []): ParsedArguments {
  return { path, flags, positionals };
}

async function run(verb: string, parsed: ParsedArguments, prompter?: IPrompter) {
  const command = findCommand(verb);
  if (!command) {
    throw new Error(`unknown verb: ${verb}`);
  }
  return await command.execute({ container: container(prompter), args: parsed });
}

function write(relativePath: string, lines: readonly string[]): void {
  writeFileSync(join(workspace, relativePath), `${lines.join('\n')}\n`);
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-interview-cmd-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-interview-cmd-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  await run('init', args(['init'], { title: '달의 문' }));
  write('character/hana.card', ['type: character', 'id: hana', 'name: 하나', 'role: main']);
  write('scene/01-night.card', [
    'type: scene',
    'id: 01-night',
    'characters:',
    '  - hana',
    'beats:',
    '  - text: 준이 하나를 심문한다',
    '    cast: [하나]',
    '  - text: 하나가 자리를 뜨려 한다',
    '    cast: [하나]',
    '  - text: 하나가 등대로 돌아간다',
    '    cast: [하나]',
  ]);
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.STORYBOARD_HOME;
  } else {
    process.env.STORYBOARD_HOME = previousHome;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('card interview', () => {
  it('refuses to run without a prompter', async () => {
    const outcome = await run('card interview', args(['card', 'interview'], {}, ['hana']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('대화형 화면에서만');
  });

  it('asks one question at a time, stops on 여기까지, and leaves candidates for card promote', async () => {
    const prompter: ScriptedPrompter = scriptedPrompter(['[Mock AI] withhold', '[Mock AI] indirect', '[Mock AI] withhold', '여기까지']);

    const outcome = await run('card interview', args(['card', 'interview'], {}, ['hana']), prompter);

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('답 3, 카드 후보 1건');
    expect(prompter.titles).toEqual([
      '1번째 · 압박 아래 방어 (01-night · 사건 1)',
      '2번째 · 호감 표출 (01-night · 사건 1)',
      '3번째 · 압박 아래 방어 (01-night · 사건 2)',
      '4번째 · 호감 표출 (01-night · 사건 2)',
    ]);
    expect(prompter.announced[0]).toBe('┌  하나 인터뷰');
    expect(prompter.announced.at(-1)).toBe('   storyboard card promote 로 반영할 수 있습니다');
    expect(existsSync(join(workspace, '.storyboard/cache/interviews/candidates.json'))).toBe(true);

    const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
    expect(preview.message).toContain('인터뷰에서  hana (하나) 변경 1건');

    const promoted = await run('card promote', args(['card', 'promote']));
    expect(promoted.ok).toBe(true);
    expect(readFileSync(join(workspace, 'character/hana.card'), 'utf8')).toContain('[Mock AI] 몰릴 때');
  });

  it('lets the writer rename a written answer to a new value and honours --limit', async () => {
    const prompter: ScriptedPrompter = scriptedPrompter(['직접 쓰기', '새 값으로'], ['웃어 버린다', '웃음으로 넘기기']);

    const outcome = await run('card interview', args(['card', 'interview'], { limit: '1' }, ['hana']), prompter);

    expect(outcome.ok).toBe(true);
    expect(prompter.titles).toEqual([
      '1번째 · 압박 아래 방어 (01-night · 사건 1)',
      '이 답을 「역공」로 읽었습니다. 맞나요?',
    ]);
    const model = JSON.parse(
      readFileSync(join(workspace, '.storyboard/cache/interviews/hana.json'), 'utf8'),
    ) as { records: { answer: { valueId: string; isNewValue: boolean } }[]; tallies: Record<string, Record<string, number>> };
    expect(model.records[0]?.answer).toMatchObject({ valueId: 'custom-4', isNewValue: true });
    expect(model.tallies['pressure-defense']).toEqual({ counter: 0, 'custom-4': 2 });
  });

  it('shows the interview hint in status and a doctor note once a card has open axes', async () => {
    const before = await run('status', args(['status']));
    expect(before.message).toContain('인터뷰    하나 — 다음 씬의 인물·장소를 아직 인터뷰하지 않았습니다 · storyboard card interview hana');

    await run('card interview', args(['card', 'interview'], { limit: '1' }, ['hana']), scriptedPrompter(['[Mock AI] withhold']));

    const after = await run('status', args(['status']));
    expect(after.message).toContain('인터뷰    하나(압박 아래 방어·호감 표출) — 다음 씬에 답이 없는 축이 있습니다');

    const doctor = await run('doctor', args(['doctor']));
    expect(doctor.message).toContain('하나(hana): 다음 씬 01-night에 답이 없는 축');
  });

  it('warns in doctor when the contract changed after the axes were drawn', async () => {
    await run('card interview', args(['card', 'interview'], { limit: '1' }, ['hana']), scriptedPrompter(['[Mock AI] withhold']));
    await run('project set', args(['project', 'set'], { genre: '스릴러' }));

    const doctor = await run('doctor', args(['doctor']));

    expect(doctor.message).toContain('인물 축 어휘를 뽑은 뒤 작품 계약');
    expect(doctor.message).toContain('--reset-axes');
  });

  it('narrows the questions to the requested scenes', async () => {
    write('scene/02-dawn.card', ['type: scene', 'id: 02-dawn', 'characters:', '  - hana', 'beats:', '  - text: 하나가 편지를 쓴다', '    cast: [하나]']);
    const prompter: ScriptedPrompter = scriptedPrompter(['[Mock AI] withhold', '여기까지']);

    await run('card interview', args(['card', 'interview'], { scenes: '2..2' }, ['hana']), prompter);

    expect(prompter.titles[0]).toBe('1번째 · 압박 아래 방어 (02-dawn · 사건 1)');
  });
});
