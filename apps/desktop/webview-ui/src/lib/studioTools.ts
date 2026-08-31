import type { StudioTarget } from './types';

export type StudioToolName =
  | 'continuityCheck'
  | 'grammarCheck'
  | 'expand'
  | 'condense'
  | 'augment'
  | 'collectFromDrafts'
  | 'cardAudit'
  | 'relationCheck';

export type StudioToolTargetKind = 'draft' | 'scene' | 'character' | 'background';

export interface StudioToolEntry {
  readonly tool: StudioToolName;
  readonly command: string;
  readonly label: string;
  readonly hint: string;
  readonly needsSelection: boolean;
  readonly targets: readonly StudioToolTargetKind[];
  // NOTE: sent when the author pins a tool and presses enter with nothing typed, so a bare
  // "/continuity" is a complete request rather than a rejected empty instruction.
  readonly defaultInstruction: string;
}

// NOTE: the command words are what the author types after "/", so they stay short and stable; the
// tool names are the contract the host and the agent share.
const studioTools: readonly StudioToolEntry[] = [
  {
    tool: 'continuityCheck',
    command: 'continuity',
    targets: ['draft'],
    label: '연속성 검사',
    hint: '설정·앞 씬과 어긋나는 곳을 찾습니다',
    needsSelection: false,
    defaultInstruction: '이 초안이 설정·앞 씬과 어긋나는 곳이 있는지 검사해줘.',
  },
  {
    tool: 'grammarCheck',
    command: 'grammar',
    targets: ['draft'],
    label: '문법 검사',
    hint: '맞춤법과 어색한 문장을 찾습니다',
    needsSelection: false,
    defaultInstruction: '이 초안의 맞춤법과 어색한 문장을 검사해줘.',
  },
  {
    tool: 'expand',
    command: 'expand',
    targets: ['draft'],
    label: '확장',
    hint: '고를 구간을 더 길게 풀어 씁니다',
    needsSelection: true,
    defaultInstruction: '이 구간을 문체를 유지한 채 더 길게 풀어 써줘.',
  },
  {
    tool: 'condense',
    command: 'condense',
    targets: ['draft'],
    label: '축소',
    hint: '고를 구간을 압축합니다',
    needsSelection: true,
    defaultInstruction: '이 구간을 사건과 대사를 보존한 채 압축해줘.',
  },
  {
    tool: 'augment',
    command: 'augment',
    targets: ['draft'],
    label: '카드 보충',
    hint: '고를 구간에 카드·설정 내용을 녹입니다',
    needsSelection: true,
    defaultInstruction: '이 구간에 인물·배경 카드와 설정 내용을 자연스럽게 보충해줘.',
  },
  {
    tool: 'collectFromDrafts',
    command: 'collect',
    targets: ['character', 'background'],
    label: '초안에서 수집',
    hint: '이 카드가 등장하는 초안에서 더할 정보를 찾습니다',
    needsSelection: false,
    defaultInstruction: '이 카드가 등장하는 초안들에서 카드에 더할 정보를 수집해서 제안해줘.',
  },
  {
    tool: 'cardAudit',
    command: 'audit',
    targets: ['character', 'background', 'scene'],
    label: '정합성 검사',
    hint: '이 카드가 다른 자료와 어긋나는지 검사합니다',
    needsSelection: false,
    defaultInstruction: '이 카드가 다른 카드·씬과 어긋나는 점이 있는지 검사해줘.',
  },
  {
    tool: 'relationCheck',
    command: 'relations',
    targets: ['character', 'background', 'scene'],
    label: '관계 점검',
    hint: '관계·참조가 실제 카드를 가리키는지 확인합니다',
    needsSelection: false,
    defaultInstruction: '이 카드의 관계와 참조가 온전한지 점검해줘.',
  },
];

// NOTE: the menu only offers what the host resolver for that file kind will actually run.
export function isToolTarget(target: StudioTarget): boolean {
  return (
    target.kind === 'draft' ||
    target.kind === 'scene' ||
    target.kind === 'character' ||
    target.kind === 'background'
  );
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

export function findTool(tool: StudioToolName): StudioToolEntry | undefined {
  return studioTools.find((entry) => entry.tool === tool);
}
