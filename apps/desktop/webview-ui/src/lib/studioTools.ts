import type { StudioTarget } from './types';

export type StudioToolName = 'continuityCheck' | 'grammarCheck' | 'expand' | 'condense' | 'augment';

export interface StudioToolEntry {
  readonly tool: StudioToolName;
  readonly command: string;
  readonly label: string;
  readonly hint: string;
  readonly needsSelection: boolean;
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
    label: '연속성 검사',
    hint: '설정·앞 씬과 어긋나는 곳을 찾습니다',
    needsSelection: false,
    defaultInstruction: '이 초안이 설정·앞 씬과 어긋나는 곳이 있는지 검사해줘.',
  },
  {
    tool: 'grammarCheck',
    command: 'grammar',
    label: '문법 검사',
    hint: '맞춤법과 어색한 문장을 찾습니다',
    needsSelection: false,
    defaultInstruction: '이 초안의 맞춤법과 어색한 문장을 검사해줘.',
  },
  {
    tool: 'expand',
    command: 'expand',
    label: '확장',
    hint: '고를 구간을 더 길게 풀어 씁니다',
    needsSelection: true,
    defaultInstruction: '이 구간을 문체를 유지한 채 더 길게 풀어 써줘.',
  },
  {
    tool: 'condense',
    command: 'condense',
    label: '축소',
    hint: '고를 구간을 압축합니다',
    needsSelection: true,
    defaultInstruction: '이 구간을 사건과 대사를 보존한 채 압축해줘.',
  },
  {
    tool: 'augment',
    command: 'augment',
    label: '카드 보충',
    hint: '고를 구간에 카드·설정 내용을 녹입니다',
    needsSelection: true,
    defaultInstruction: '이 구간에 인물·배경 카드와 설정 내용을 자연스럽게 보충해줘.',
  },
];

// NOTE: tools run against the draft body, so the menu stays hidden for card conversations rather
// than offering something the host would refuse.
export function isToolTarget(target: StudioTarget): boolean {
  return target.kind === 'draft';
}

export function slashToken(value: string): string | undefined {
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : undefined;
}

export function toolCandidates(token: string): readonly StudioToolEntry[] {
  const lowered = token.toLowerCase();

  return studioTools.filter(
    (entry) => entry.command.startsWith(lowered) || entry.tool.toLowerCase().startsWith(lowered),
  );
}

export function findTool(tool: StudioToolName): StudioToolEntry | undefined {
  return studioTools.find((entry) => entry.tool === tool);
}
