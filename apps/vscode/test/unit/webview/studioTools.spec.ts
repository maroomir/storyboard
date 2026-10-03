import { describe, expect, it } from 'vitest';

import {
  isSpanRequiredTool,
  studioAgentToolNames,
  studioToolNamesByShape,
} from '@storyboard/story-model';

import { findTool, isToolTarget, slashToken, toolCandidates } from '@webview/lib/studioTools';
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
  it('lists the draft tools and the wizard while a draft is open', () => {
    expect(toolCandidates('', target('draft'))).toHaveLength(6);
  });

  it('lists the card tools while a card is open', () => {
    expect(toolCandidates('', target('character')).map((entry) => entry.tool)).toEqual([
      'collectFromDrafts',
      'cardAudit',
      'updateCard',
      'relationCheck',
    ]);
  });

  it('keeps collect away from a scene card', () => {
    expect(toolCandidates('', target('scene')).map((entry) => entry.tool)).toEqual([
      'cardAudit',
      'updateCard',
      'relationCheck',
    ]);
  });

  it('narrows by the typed prefix', () => {
    expect(toolCandidates('con', target('draft')).map((entry) => entry.tool)).toEqual([
      'continuityCheck',
      'condense',
    ]);
  });

  it('matches the contract name as well as the typed command', () => {
    expect(toolCandidates('grammarc', target('draft')).map((entry) => entry.tool)).toEqual([
      'grammarCheck',
    ]);
  });

  it('returns nothing for an unknown token', () => {
    expect(toolCandidates('deploy', target('draft'))).toEqual([]);
  });
});

describe('isToolTarget', () => {
  it('keeps the slash menu live everywhere so the create wizard is reachable', () => {
    expect(isToolTarget(target('draft'))).toBe(true);
    expect(isToolTarget(target('none'))).toBe(true);
  });

  it('offers only the wizard when nothing is open', () => {
    expect(toolCandidates('', target('none')).map((entry) => entry.tool)).toEqual(['updateCard']);
  });
});

describe('findTool', () => {
  it('gives every agent tool a default instruction so a bare pin can be sent', () => {
    const entries = [
      ...toolCandidates('', target('draft')),
      ...toolCandidates('', target('character')),
    ].filter((entry) => entry.tool !== 'updateCard');

    for (const entry of entries) {
      expect(findTool(entry.tool)?.defaultInstruction.trim().length).toBeGreaterThan(0);
    }
  });
});

// 도구 목록과 선택 필요 여부는 계약이 갖고, 이 파일은 명령어·설명만 갖는다. 계약에 도구가 늘었는데
// 화면 항목을 빠뜨리면 슬래시 메뉴에서 조용히 사라지므로 여기서 막는다.
describe('studio tool table against the contract', () => {
  it('presents every agent tool the contract declares', () => {
    for (const tool of studioAgentToolNames) {
      expect(findTool(tool), `${tool} has no composer entry`).toBeDefined()
    }
  })

  it('asks for a selection exactly where the contract requires a span', () => {
    for (const tool of studioAgentToolNames) {
      expect(findTool(tool)?.needsSelection, `${tool} selection rule`).toBe(isSpanRequiredTool(tool))
    }
  })

  it('offers a draft tool on drafts and a card tool on cards', () => {
    for (const tool of studioToolNamesByShape.draft) {
      expect(findTool(tool)?.targets, `${tool} targets`).toContain('draft')
    }

    for (const tool of studioToolNamesByShape.entityCard) {
      expect(findTool(tool)?.targets, `${tool} targets`).toContain('character')
    }
  })
})
