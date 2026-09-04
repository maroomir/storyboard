import { describe, expect, it } from 'vitest';

import { commandCatalog, flagCatalog } from '../src/commands/catalog';
import { commands } from '../src/commands/index';
import { renderCommandHelp, renderUnknownCommand, renderUsage, suggestVerbs } from '../src/help';

describe('command catalog', () => {
  it('describes every verb the CLI implements, and nothing else', () => {
    const catalogVerbs = new Set(commandCatalog.map((spec) => spec.verb));
    const implemented = new Set([...Object.keys(commands), 'help', 'tui', 'completion']);

    expect([...implemented].filter((verb) => !catalogVerbs.has(verb))).toEqual([]);
    expect([...catalogVerbs].filter((verb) => !implemented.has(verb))).toEqual([]);
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
      '씬과 초안',
      '카드와 정전',
      '검사',
      '원고',
      '유지보수',
    ]) {
      expect(usage).toContain(`\n${group}\n`);
    }
    expect(usage).toContain('~/.storyboard/config.json');
  });
});

describe('renderCommandHelp', () => {
  it('shows usage, the verb-specific flags, and examples', () => {
    const help = renderCommandHelp('scene generate');

    expect(help).toContain('storyboard scene generate <stem> | --all');
    expect(help).toContain('--all');
    expect(help).toContain('--force');
    expect(help).toContain('storyboard scene generate --all');
    expect(help).toContain('--workspace');
  });

  it('returns nothing for an unknown verb', () => {
    expect(renderCommandHelp('scene fly')).toBeUndefined();
  });
});

describe('suggestVerbs', () => {
  it('offers the closest real verbs for a near miss', () => {
    expect(suggestVerbs('scene generat')).toContain('scene generate');
    expect(suggestVerbs('generate')).toEqual(
      expect.arrayContaining(['scene generate', 'outline generate']),
    );
    expect(renderUnknownCommand('scen generate')).toContain('storyboard scene generate');
    expect(renderUnknownCommand('xyzzy')).toContain('storyboard --help');
  });
});
