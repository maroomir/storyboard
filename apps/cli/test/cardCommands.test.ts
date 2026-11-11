import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

describe('init --repair and copied uuids', () => {
  it('gives the later of two folders sharing a uuid a new one', async () => {
    const original: string = join(workspace, 'character', 'elia.card');
    const copy: string = join(workspace, 'character', 'elia-copy.card');
    cpSync(original, copy, { recursive: true });
    writeFileSync(join(copy, 'card.yaml'), readFileSync(join(copy, 'card.yaml'), 'utf8').replace('slug: elia', 'slug: elia-copy'));
    utimesSync(join(original, 'card.yaml'), new Date('2026-01-01'), new Date('2026-01-01'));

    const repaired = await run('init', args(['init'], { repair: true }));

    expect(repaired.ok, repaired.message).toBe(true);
    expect(repaired.message).toContain('character/elia-copy.card 에 새 uuid 를 주었습니다');
    const idOf = (folder: string): string | undefined =>
      /^id: (.+)$/m.exec(readFileSync(join(folder, 'card.yaml'), 'utf8'))?.[1];
    expect(idOf(copy)).not.toBe(idOf(original));
  });
});

describe('doctor on bundles', () => {
  interface Check {
    readonly status: string;
    readonly label: string;
    readonly detail: string;
  }

  async function checks(): Promise<readonly Check[]> {
    const outcome = await run('doctor', args(['doctor']));
    return (outcome.data as { checks: Check[] }).checks;
  }

  it('fails on a copied uuid until init --repair gives the copy its own', async () => {
    cpSync(join(workspace, 'character', 'sera.card'), join(workspace, 'character', 'sera-copy.card'), {
      recursive: true,
    });
    const copyCard: string = join(workspace, 'character', 'sera-copy.card', 'card.yaml');
    writeFileSync(copyCard, readFileSync(copyCard, 'utf8').replace('slug: sera', 'slug: sera-copy'));

    expect((await checks()).find((check) => check.label === '복사된 uuid')?.status).toBe('fail');
    await run('init', args(['init'], { repair: true }));
    expect((await checks()).some((check) => check.label === '복사된 uuid')).toBe(false);
  });

  it('warns about a file no bundle knows and a folder out of structure order', async () => {
    writeFileSync(join(workspace, 'character', 'elia.card', 'notes.txt'), '메모\n');
    await writeSceneBundleFromYaml(workspace, 'type: scene\nid: 001-rooftop\ntitle: 옥상\n');
    renameSync(join(workspace, 'scene', '001-rooftop.card'), join(workspace, 'scene', '007-rooftop.card'));

    const found: readonly Check[] = await checks();
    expect(found.find((check) => check.label === '번들의 모르는 파일')?.detail).toContain('notes.txt');
    expect(found.find((check) => check.label === '씬 번호')?.detail).toContain('007-rooftop.card');

    await run('init', args(['init'], { repair: true }));
    expect(existsSync(join(workspace, 'scene', '001-rooftop.card'))).toBe(true);
    expect((await checks()).some((check) => check.label === '씬 번호')).toBe(false);
  });

  it('notes a background no scene uses and an alias two backgrounds share', async () => {
    writeCardBundleFromYaml(workspace, 'type: location\nid: market\nname: 야시장\naliases:\n  - 시장\n');
    writeCardBundleFromYaml(workspace, 'type: location\nid: harbor\nname: 항구\naliases:\n  - 시장\n');
    await writeSceneBundleFromYaml(workspace, 'type: scene\nid: 001-night\ntitle: 밤\nbeats:\n  - text: 걷는다\n    place: market\n');

    const found: readonly Check[] = await checks();
    expect(found.find((check) => check.label === '쓰이지 않는 배경')?.detail).toContain('harbor');
    expect(found.find((check) => check.label === '겹치는 별칭')?.detail).toContain('«시장»');
  });
});
