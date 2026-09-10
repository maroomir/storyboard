import {
  isSpanRequiredTool,
  studioToolNamesByShape,
  type StudioAgentToolName,
} from '@storyboard/story-engine/contracts';

import type { StudioTarget } from './types';

export type StudioToolName = StudioAgentToolName;

export type StudioToolTargetKind =
  | 'draft'
  | 'scene'
  | 'character'
  | 'background'
  | 'project'
  | 'none';

// NOTE: the composer can pin either an agent tool or the create wizard; only the former rides the
// chat request as `tool`.
export type StudioComposerTool = StudioToolName | 'updateCard';

interface StudioToolPresentation {
  readonly tool: StudioComposerTool;
  readonly command: string;
  readonly label: string;
  readonly hint: string;
  // NOTE: sent when the author pins a tool and presses enter with nothing typed, so a bare
  // "/continuity" is a complete request rather than a rejected empty instruction.
  readonly defaultInstruction: string;
}

export interface StudioToolEntry extends StudioToolPresentation {
  readonly needsSelection: boolean;
  readonly targets: readonly StudioToolTargetKind[];
}

// 어떤 카드·초안에서 어떤 도구가 보이는지는 계약의 `studioToolNamesByShape` 가 정한다. 여기서는
// 그 모양을 이 화면의 대상 종류로 옮기기만 한다.
const shapeTargetKinds: Record<
  keyof typeof studioToolNamesByShape,
  readonly StudioToolTargetKind[]
> = {
  draft: ['draft'],
  entityCard: ['character', 'background'],
  sceneCard: ['scene'],
};

// 창작 마법사는 에이전트 도구가 아니라 어느 화면에서나 열리는 항목이라 계약에 없다.
const createWizardTargets: readonly StudioToolTargetKind[] = [
  'draft',
  'scene',
  'character',
  'background',
  'project',
  'none',
];

function targetsForTool(tool: StudioComposerTool): readonly StudioToolTargetKind[] {
  if (tool === 'updateCard') {
    return createWizardTargets;
  }

  const kinds = new Set<StudioToolTargetKind>();
  for (const [shape, tools] of Object.entries(studioToolNamesByShape)) {
    if ((tools as readonly string[]).includes(tool)) {
      for (const kind of shapeTargetKinds[shape as keyof typeof studioToolNamesByShape]) {
        kinds.add(kind);
      }
    }
  }

  return [...kinds];
}

function needsSelectionForTool(tool: StudioComposerTool): boolean {
  return tool !== 'updateCard' && isSpanRequiredTool(tool);
}

// NOTE: the command words are what the author types after "/", so they stay short and stable; the
// tool names are the contract the host and the agent share.
const studioToolPresentations: readonly StudioToolPresentation[] = [
  {
    tool: 'continuityCheck',
    command: 'continuity',
    label: '연속성 검사',
    hint: '설정·앞 씬과 어긋나는 곳을 찾습니다',
    defaultInstruction: '이 초안이 설정·앞 씬과 어긋나는 곳이 있는지 검사해줘.',
  },
  {
    tool: 'grammarCheck',
    command: 'grammar',
    label: '문법 검사',
    hint: '맞춤법과 어색한 문장을 찾습니다',
    defaultInstruction: '이 초안의 맞춤법과 어색한 문장을 검사해줘.',
  },
  {
    tool: 'expand',
    command: 'expand',
    label: '확장',
    hint: '고를 구간을 더 길게 풀어 씁니다',
    defaultInstruction: '이 구간을 문체를 유지한 채 더 길게 풀어 써줘.',
  },
  {
    tool: 'condense',
    command: 'condense',
    label: '축소',
    hint: '고를 구간을 압축합니다',
    defaultInstruction: '이 구간을 사건과 대사를 보존한 채 압축해줘.',
  },
  {
    tool: 'augment',
    command: 'augment',
    label: '카드 보충',
    hint: '고를 구간에 카드·설정 내용을 녹입니다',
    defaultInstruction: '이 구간에 인물·배경 카드와 설정 내용을 자연스럽게 보충해줘.',
  },
  {
    tool: 'collectFromDrafts',
    command: 'collect',
    label: '초안에서 수집',
    hint: '이 카드가 등장하는 초안에서 더할 정보를 찾습니다',
    defaultInstruction: '이 카드가 등장하는 초안들에서 카드에 더할 정보를 수집해서 제안해줘.',
  },
  {
    tool: 'cardAudit',
    command: 'audit',
    label: '정합성 검사',
    hint: '이 카드가 다른 자료와 어긋나는지 검사합니다',
    defaultInstruction: '이 카드가 다른 카드·씬과 어긋나는 점이 있는지 검사해줘.',
  },
  {
    tool: 'updateCard',
    command: 'update',
    label: '카드 업데이트',
    hint: '설명문으로 인물·배경 카드를 만들거나 채웁니다',
    defaultInstruction: '',
  },
  {
    tool: 'relationCheck',
    command: 'relations',
    label: '관계 점검',
    hint: '관계·참조가 실제 카드를 가리키는지 확인합니다',
    defaultInstruction: '이 카드의 관계와 참조가 온전한지 점검해줘.',
  },
];

const studioTools: readonly StudioToolEntry[] = studioToolPresentations.map((presentation) => ({
  ...presentation,
  needsSelection: needsSelectionForTool(presentation.tool),
  targets: targetsForTool(presentation.tool),
}));

// NOTE: every target kind offers at least the create wizard, so the slash menu is always live.
export function isToolTarget(target: StudioTarget): boolean {
  return toolCandidates('', target).length > 0;
}

export function slashToken(value: string): string | undefined {
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : undefined;
}

export function toolCandidates(token: string, target: StudioTarget): readonly StudioToolEntry[] {
  const lowered = token.toLowerCase();

  return studioTools.filter(
    (entry) =>
      entry.targets.some((kind) => kind === target.kind) &&
      (entry.command.startsWith(lowered) || entry.tool.toLowerCase().startsWith(lowered)),
  );
}

export function findTool(tool: StudioComposerTool): StudioToolEntry | undefined {
  return studioTools.find((entry) => entry.tool === tool);
}
