import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedArguments } from '@/cliArguments';
import type { IPrompter } from '@/adapters/prompter';
import { findCommand } from '@/commands/index';
import { createCliContainer, type CliContainer } from '@/container';
import { readBundleText, writeCardBundleFromYaml } from './fixtures/cardBundles';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';

let home: string;
let workspace: string;
let previousHome: string | undefined;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

const personAtTheTerminal: IPrompter = {
  shouldConfirmPaidRuns: false,
  announce: () => undefined,
  askText: async () => undefined,
  choose: async () => undefined,
};

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

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-card-cmd-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-card-cmd-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  await run('init', args(['init'], { title: '달의 문' }));
  writeCardBundleFromYaml(
    workspace,
    'type: character\nid: elia\nname: 엘리아\nrole: main\nrelations:\n  - target: sera\n    type: 소꿉친구\n',
  );
  writeCardBundleFromYaml(workspace, 'type: character\nid: sera\nname: 세라\nrole: supporting\n');
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

describe('card set and card unset', () => {
  it('writes an author line when a person runs it and an agent line otherwise', async () => {
    const byPerson = await run(
      'card set',
      args(['card', 'set'], {}, ['elia', 'traits', '몰리면 먼저 웃는다']),
      personAtTheTerminal,
    );
    const byAgent = await run('card set', args(['card', 'set'], { about: 'sera' }, ['elia', 'speech', '반말']));

    expect(byPerson.ok, byPerson.message).toBe(true);
    expect(byPerson.message).toContain('출처 author');
    expect(byAgent.message).toContain('출처 agent');
    const sources = await run('card show', args(['card', 'show'], { sources: true }, ['elia']));
    expect(sources.message).toMatch(/traits: 몰리면 먼저 웃는다 {2}← author · card set/);
    expect(sources.message).toMatch(/speech →sera: 반말 {2}← agent · card set/);
  });

  it('refuses a facet the card does not have and removes a line by its facet', async () => {
    const refused = await run('card set', args(['card', 'set'], {}, ['elia', 'layout', '창가']));
    expect(refused.ok).toBe(false);

    await run('card set', args(['card', 'set'], {}, ['elia', 'traits', '몰리면 먼저 웃는다']));
    const removed = await run('card unset', args(['card', 'unset'], {}, ['elia', 'traits', '몰리면 먼저 웃는다']));
    expect(removed.ok, removed.message).toBe(true);
    expect(readBundleText(workspace, 'character', 'elia')).not.toContain('몰리면 먼저 웃는다');
    expect((await run('card unset', args(['card', 'unset'], {}, ['elia', 'traits']))).ok).toBe(false);
  });
});

describe('card remove', () => {
  beforeEach(async () => {
    await writeSceneBundleFromYaml(
      workspace,
      'type: scene\nid: 001-rooftop\ntitle: 옥상\nbeats:\n  - text: 둘이 만난다\n    cast: [elia, sera]\n',
    );
  });

  it('shows what refers to the card and needs --force while anything does', async () => {
    const refused = await run('card remove', args(['card', 'remove'], {}, ['sera']));

    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('--force');
    expect(refused.message).toContain('함께 지울 줄:');
    expect(refused.message).toContain('소꿉친구');

    const removed = await run('card remove', args(['card', 'remove'], { force: true }, ['sera']));
    expect(removed.ok, removed.message).toBe(true);
    expect(removed.message).toContain('character/sera.card 를 지웠습니다');
    expect((await run('card show', args(['card', 'show'], {}, ['sera']))).ok).toBe(false);
  });
});

describe('card show --history and card edit', () => {
  it('records each edit as a session of the card', async () => {
    const empty = await run('card show', args(['card', 'show'], { history: true }, ['elia']));
    expect(empty.message).toBe('elia 의 세션 기록이 없습니다.');

    const edited = await run('card edit', args(['card', 'edit'], { propose: true }, ['elia', '말투를 더 퉁명스럽게']));
    expect(edited.ok, edited.message).toBe(true);

    const history = await run('card show', args(['card', 'show'], { history: true }, ['elia']));
    expect(history.message).toContain('스튜디오');
  });

  it('refuses an instruction for a card that does not exist', async () => {
    const outcome = await run('card edit', args(['card', 'edit'], {}, ['nobody', '고쳐 줘']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('카드를 찾을 수 없습니다: nobody');
  });
});
