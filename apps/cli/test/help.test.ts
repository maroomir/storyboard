import { readFileSync } from 'node:fs';

import { createWorkspaceAgentGuide } from '@storyboard/story-engine';
import { describe, expect, it } from 'vitest';

import {
  commandCatalog,
  completionShells,
  flagCatalog,
  globalFlagNames,
  initLanguages,
} from '../src/commands/catalog';
import { computeCompletions } from '../src/commands/completion';
import { commands } from '../src/commands/index';
import { renderCommandHelp, renderUnknownCommand, renderUsage, suggestVerbs } from '../src/help';

const setupSource = readFileSync(new URL('../src/commands/setup.ts', import.meta.url), 'utf8');
const commandMentionPattern = /storyboard ([a-z][a-z0-9-]*)(?: ([a-z][a-z0-9-]*))?/g;

describe('command catalog', () => {
  it('describes every verb the CLI implements, and nothing else', () => {
    const catalogVerbs = new Set(commandCatalog.map((spec) => spec.verb));
    const implemented = new Set([...Object.keys(commands), 'help', 'tui', 'completion']);

    expect([...implemented].filter((verb) => !catalogVerbs.has(verb))).toEqual([]);
    expect([...catalogVerbs].filter((verb) => !implemented.has(verb))).toEqual([]);
  });

  // NOTE: doctor 의 fix 안내는 사용자가 그대로 복사해 실행한다. 존재하지 않는 verb 를 적으면
  // 진단만 맞고 처방이 틀린 채로 통과한다.
  it('is the only source of the commands doctor and setup tell users to run', () => {
    const catalogVerbs = new Set(commandCatalog.map((spec) => spec.verb));

    for (const [, head, tail] of setupSource.matchAll(commandMentionPattern)) {
      const verb =
        tail !== undefined && catalogVerbs.has(`${head} ${tail}`) ? `${head} ${tail}` : head;

      expect(catalogVerbs, `setup.ts tells the user to run "storyboard ${verb}"`).toContain(verb);
    }
  });

  // NOTE: 작품 저장소의 AGENTS.md 는 에이전트가 그대로 실행하는 명령표다. verb 뒤에 종류 인자가
  // 붙은 줄(card create character)도 가장 긴 일치로 찾고, 같은 줄의 플래그가 그 verb 의 것인지도 본다.
  it('is the only source of the commands the workspace agent guide names', () => {
    const verbsLongestFirst = commandCatalog
      .map((spec) => spec.verb)
      .sort((left, right) => right.split(' ').length - left.split(' ').length);
    const mentions = createWorkspaceAgentGuide().matchAll(/storyboard((?: [a-z][a-z-]*)+)/g);
    let checked = 0;

    for (const [mention, words] of mentions) {
      const spoken = words.trim();
      const verb = verbsLongestFirst.find((candidate) => `${spoken} `.startsWith(`${candidate} `));

      expect(verb, `AGENTS.md tells the agent to run "${mention}"`).toBeDefined();
      checked += 1;
    }

    expect(checked).toBeGreaterThan(20);
  });

  it('only names flags the guide verbs accept', () => {
    const guide = createWorkspaceAgentGuide();
    const known = new Set([...globalFlagNames, ...commandCatalog.flatMap((spec) => spec.flags ?? [])]);

    for (const [, flag] of guide.matchAll(/--([a-z][a-z-]*)/g)) {
      expect(known, `AGENTS.md names --${flag}`).toContain(flag);
    }

    for (const [line, words, flag] of guide.matchAll(/storyboard ([a-z][a-z -]*?)(?: <stem>)? --([a-z-]+)/g)) {
      const spec = commandCatalog.find((candidate) => words.trim() === candidate.verb);

      expect(spec?.flags ?? [], `AGENTS.md: "${line}"`).toContain(flag);
    }
  });

  it('only references flags the parser knows', () => {
    const known = new Set(flagCatalog.map((flag) => flag.name));

    for (const spec of commandCatalog) {
      for (const flag of spec.flags ?? []) {
        expect(known, `${spec.verb} uses unknown flag --${flag}`).toContain(flag);
      }
    }
  });
});

describe('renderUsage', () => {
  it('opens with getting-started steps and groups the commands', () => {
    const usage = renderUsage('9.9.9');

    expect(usage).toContain('storyboard 9.9.9');
    expect(usage).toContain('처음이라면');
    expect(usage.indexOf('storyboard init --title')).toBeLessThan(usage.indexOf('시작하기'));
    for (const group of [
      '시작하기',
      '기획',
      '씬',
      '초안',
      '카드와 정전',
      '노트',
      '원고',
      '측정',
    ]) {
      expect(usage).toContain(`\n${group}\n`);
    }
    expect(usage).toContain('~/.storyboard/config.json');
  });
});

describe('renderCommandHelp', () => {
  it('shows usage, the verb-specific flags, and examples', () => {
    const help = renderCommandHelp('draft generate');

    expect(help).toContain('storyboard draft generate <stem> | --all');
    expect(help).toContain('--all');
    expect(help).toContain('--force');
    expect(help).toContain('storyboard draft generate --all');
    expect(help).toContain('--workspace');
  });

  it('returns nothing for an unknown verb', () => {
    expect(renderCommandHelp('scene fly')).toBeUndefined();
  });
});

describe('suggestVerbs', () => {
  it('offers the closest real verbs for a near miss', () => {
    expect(suggestVerbs('draft generat')).toContain('draft generate');
    expect(suggestVerbs('generate')).toEqual(
      expect.arrayContaining(['draft generate', 'outline generate']),
    );
    expect(renderUnknownCommand('draf generate')).toContain('storyboard draft generate');
    expect(renderUnknownCommand('xyzzy')).toContain('storyboard --help');
  });

  // 옛 이름은 별칭 없이 사라졌다. 그 이름을 친 에이전트가 새 이름을 제안에서 찾을 수 있어야 한다.
  it('leads a renamed command to its new name', () => {
    const renamed: Readonly<Record<string, string>> = {
      'scene generate': 'draft generate',
      'scene revise': 'draft revise',
      'scene seeds': 'scene seed',
      'check slop': 'draft check',
      'cards build': 'card build',
      'bible promote': 'canon promote',
      'manuscript summaries': 'manuscript summarize',
    };

    for (const [oldName, newName] of Object.entries(renamed)) {
      expect(suggestVerbs(oldName), oldName).toContain(newName);
    }
  });
});

// 옵션 목록·셸 목록·언어 목록이 도움말과 자동완성에 따로 적혀 있던 시절에는 «도움말에는 있는데
// 완성되지 않는» 옵션이 생겼다. 이제 한 목록에서 나오는지 여기서 본다.
describe('surfaces built from one list', () => {
  it('prints every global flag in the top-level help', () => {
    const usage = renderUsage();

    for (const name of globalFlagNames) {
      expect(usage, `--${name} is missing from the help`).toContain(`--${name}`);
    }
  });

  it('names every completion shell in the verb usage line', () => {
    const spec = commandCatalog.find((entry) => entry.verb === 'completion');

    for (const shell of completionShells) {
      expect(spec?.usage, `${shell} is missing from the usage line`).toContain(shell);
    }
  });

  it('completes exactly the languages init accepts', () => {
    const completions = computeCompletions(['init', '--language', ''], { cwd: process.cwd() });

    expect(completions.map((entry) => entry.text)).toEqual([...initLanguages]);
  });
});
