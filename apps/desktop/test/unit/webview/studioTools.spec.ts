import { describe, expect, it } from 'vitest';

import {
  findTool,
  isToolTarget,
  slashToken,
  toolCandidates,
} from '@webview/lib/studioTools';
import type { StudioTarget } from '@webview/lib/types';

function target(kind: StudioTarget['kind']): StudioTarget {
  return { kind, hasSelection: false };
}

describe('slashToken', () => {
  it('reads the token of a bare slash entry', () => {
    expect(slashToken('/')).toBe('');
    expect(slashToken('/exp')).toBe('exp');
  });

  it('ignores a slash that is part of a sentence', () => {
    expect(slashToken('앞 문단 /확장 해줘')).toBeUndefined();
    expect(slashToken('경로는 draft/01.md 야')).toBeUndefined();
  });
});

describe('toolCandidates', () => {
  it('lists every tool for an empty token', () => {
    expect(toolCandidates('')).toHaveLength(5);
  });

  it('narrows by the typed prefix', () => {
    expect(toolCandidates('con').map((entry) => entry.tool)).toEqual([
      'continuityCheck',
      'condense',
    ]);
  });

  it('matches the contract name as well as the typed command', () => {
    expect(toolCandidates('grammarc').map((entry) => entry.tool)).toEqual(['grammarCheck']);
  });

  it('returns nothing for an unknown token', () => {
    expect(toolCandidates('deploy')).toEqual([]);
  });
});

describe('isToolTarget', () => {
  it('offers tools only while a draft is open', () => {
    expect(isToolTarget(target('draft'))).toBe(true);
    expect(isToolTarget(target('scene'))).toBe(false);
    expect(isToolTarget(target('character'))).toBe(false);
    expect(isToolTarget(target('none'))).toBe(false);
  });
});

describe('findTool', () => {
  it('gives every tool a default instruction so a bare pin can be sent', () => {
    for (const entry of toolCandidates('')) {
      expect(findTool(entry.tool)?.defaultInstruction.trim().length).toBeGreaterThan(0);
    }
  });
});
