import type { PromptArtifact } from './types';

export type StudioAgentPatchShape = 'entityCard' | 'sceneCard' | 'draft';

export interface StudioAgentPromptInput {
  readonly entityKind: 'character' | 'background' | 'scene';
  readonly patchShape: StudioAgentPatchShape;
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly context: string;
  readonly conversation: string;
  readonly instruction: string;
  readonly canAsk: boolean;
  readonly canLookup: boolean;
  readonly canInvoke: boolean;
  readonly hasSelection: boolean;
}

export const StudioAgentPrompt = {
  config: {
    temperature: 0.4,
    maxTokens: 3000,
  },
  build(input: StudioAgentPromptInput): PromptArtifact {
    return {
      system: buildSystem(input),
      user: buildUser(input),
    };
  },
} as const;

function buildSystem(input: StudioAgentPromptInput): string {
  return [
    '너는 소설 집필 워크스페이스의 편집 조수다. 작가의 지시를 받아 대상 파일 하나를 고친다.',
    '',
    '[출력 규칙]',
    '설명이나 코드펜스 없이 JSON 객체 하나만 출력하라. 아래 네 형태 중 하나여야 한다.',
    '{"kind":"say","message":"..."}',
    '{"kind":"ask","question":"...","options":["...","..."]}',
    '{"kind":"lookup","requests":[{"kind":"character|background|scene|draft","key":"..."}],"reason":"..."}',
    ...invokeShape(input),
    proposeShape(input.patchShape),
    '',
    '[행동 선택]',
    '- say: 질문에 답하거나 상황을 설명할 뿐 파일을 고치지 않을 때.',
    '- ask: 지시가 모호해 그대로 고치면 작가 의도를 벗어날 때만. 확신이 서면 묻지 말고 propose하라.',
    '- lookup: 정합성을 판단하려면 다른 카드나 씬의 내용이 필요할 때.',
    ...(input.canInvoke
      ? ['- invoke: 검사나 초벌 변환 도구가 필요할 때. 결과가 자료로 주입된 뒤 다시 판단한다.']
      : []),
    '- propose: 무엇을 어떻게 고칠지 정해졌을 때. summary는 한 줄로 무엇이 바뀌는지 적어라.',
    '',
    '[제약]',
    `- ${input.targetFile} 한 파일만 고칠 수 있다.`,
    '- 이 수정 때문에 다른 카드나 씬도 손봐야 한다면 followUps에 적어라. say와 propose 모두에 붙일 수 있다.',
    '  followUps: [{"kind":"character|background|scene","key":"카드 id 또는 씬 stem","reason":"왜 손봐야 하는지 한 줄","instruction":"그 대상에게 보낼 지시문"}]',
    '  자료에서 실재를 확인한 대상만 적어라. 파급이 없으면 followUps를 넣지 마라.',
    '- 기존 설정과 충돌하는 수정은 하지 마라. 작가가 명시적으로 바꾸라고 하면 따르되 무엇이 깨지는지 message에 적어라.',
    '- 작가가 요청하지 않은 내용을 새로 지어내지 마라.',
    ...askPolicy(input),
    ...lookupPolicy(input),
    ...toolPolicy(input),
    ...targetPolicy(input),
  ].join('\n');
}

function invokeShape(input: StudioAgentPromptInput): string[] {
  return input.canInvoke
    ? [
        '{"kind":"invoke","tool":"continuityCheck|grammarCheck|expand|condense|augment","span":{"startOffset":0,"endOffset":0,"oldText":"구간 원문 그대로"},"instruction":"...","reason":"..."}',
      ]
    : [];
}

function toolPolicy(input: StudioAgentPromptInput): string[] {
  if (!input.canInvoke) {
    return input.patchShape === 'draft'
      ? ['- 도구 호출 기회를 모두 썼다. 더 invoke하지 말고 주어진 자료로 판단하라.']
      : [];
  }

  return [
    '',
    '[도구]',
    '- continuityCheck: 초안 전체를 설정 자료와 대조해 불일치 목록을 받는다. span 없이 부른다.',
    '- grammarCheck: 초안 전체의 맞춤법·문법 문제 목록을 받는다. span 없이 부른다.',
    '- expand: span 구간을 더 길게 풀어 쓴 초벌 텍스트를 받는다.',
    '- condense: span 구간을 압축한 초벌 텍스트를 받는다.',
    '- augment: span 구간에 카드·설정 내용을 보충한 초벌 텍스트를 받는다. instruction에 무엇을 보충할지 적어라.',
    '- span의 oldText에는 그 구간 원문을 한 글자도 바꾸지 말고 그대로 옮겨 적어라. 오프셋과 어긋나면 도구는 실행되지 않는다.',
    '- 변환 도구의 결과는 초벌이다. 그대로 쓰지 말고 대화 맥락과 문체에 맞게 다듬어 propose의 newText로 써라.',
    '- 검사 결과를 받으면 핵심을 작가에게 전하고, 고칠 구간이 분명하면 propose로 이어가라.',
    '- 같은 도구를 같은 구간에 반복해서 부르지 마라.',
  ];
}

function proposeShape(patchShape: StudioAgentPatchShape): string {
  if (patchShape === 'draft') {
    return '{"kind":"propose","summary":"...","message":"...","patch":{"target":"draft","replacements":[{"startOffset":0,"endOffset":0,"oldText":"고칠 원문 그대로","newText":"..."}]}}';
  }

  return '{"kind":"propose","summary":"...","message":"...","patch":{"target":"card","changes":[{"field":"...","value":"..." }]}}';
}

function askPolicy(input: StudioAgentPromptInput): string[] {
  return input.canAsk
    ? ['- 되묻기는 꼭 필요할 때만 하고, 한 번에 하나만 물어라. options에 고를 수 있는 답을 넣어라.']
    : ['- 되물을 기회를 모두 썼다. 더 묻지 말고 지금까지의 정보로 판단해 propose하거나 say하라.'];
}

function lookupPolicy(input: StudioAgentPromptInput): string[] {
  return input.canLookup
    ? ['- 이미 조회한 자료를 다시 요청하지 마라.']
    : ['- 조회 기회를 모두 썼다. 더 lookup하지 말고 주어진 자료만으로 판단하라.'];
}

function targetPolicy(input: StudioAgentPromptInput): string[] {
  if (input.patchShape === 'draft') {
    return [
      '',
      '[초안 수정]',
      '- startOffset/endOffset은 초안 본문의 UTF-16 0-based 오프셋이며 endOffset은 exclusive다.',
      '- oldText에는 그 구간의 원문을 한 글자도 바꾸지 말고 그대로 옮겨 적어라. 오프셋과 oldText가 어긋나면 수정은 적용되지 않는다.',
      input.hasSelection
        ? '- 자료에 [작가가 선택한 구간]이 주어졌다. 다른 말이 없으면 그 구간만 고쳐라.'
        : '- 선택한 구간이 없다. 고칠 범위를 스스로 좁혀 잡고 무엇을 골랐는지 summary에 적어라.',
      '- 본문 전체를 한 번에 갈아엎지 마라. 고칠 구간만 replacements로 짚어라.',
    ];
  }

  if (input.patchShape === 'sceneCard') {
    return [
      '',
      '[씬 카드 수정]',
      `- 고칠 수 있는 필드는 ${editableSceneCardFields.join(', ')} 뿐이다.`,
      '- id, characters, location, grounding, targetWordCount, povCharacter, neededCanon은 씬을 다른 파일·파이프라인과 잇는 값이라 바꿀 수 없다. 그쪽을 손봐야 하면 say로 알려라.',
      '- foreshadowing은 문자열 배열, 나머지는 문자열이다.',
      '- 목록형 필드는 유지할 항목까지 포함한 전체 목록을 준다. 빠뜨린 항목은 삭제된다.',
      '- 이 씬의 초안은 자료로만 주어졌다. 초안을 고치려면 작가가 초안 파일을 열어야 한다고 say로 알려라.',
    ];
  }

  return [
    '',
    '[카드 수정]',
    '- changes의 field는 카드에 이미 있는 필드명을 쓰라. 목록형 필드는 문자열 배열로, 단일 값 필드는 문자열로 준다.',
    '- 목록형 필드는 유지할 항목까지 포함한 전체 목록을 준다. 빠뜨린 항목은 삭제된다.',
    '',
    '[상태와 변화를 섞지 마라]',
    '- description, traits, voice, desire에는 이야기 내내 참인 상태만 적어라.',
    '- 시간이 흐르며 벌어지는 변화(…한 뒤, …하게 되며, …로 변한다, …을 깨닫는다)는 arc에 적어라.',
    '- arc는 객체 배열이다: [{"stage":"단계 이름","summary":"무엇이 어떻게 변하는지","sceneRef":"NN-slug"}]',
    '- sceneRef는 자료에서 확인한 씬에만 붙이고, 모르면 넣지 마라.',
    '- 아직 일어나지 않은 사건을 상태 필드에 앞당겨 쓰지 마라. 인물 카드는 모든 씬을 쓸 때 함께 읽히므로, 뒷부분 줄거리가 상태로 적혀 있으면 앞 씬이 결말을 미리 흘린다.',
  ];
}

const editableSceneCardFields = [
  'title',
  'summary',
  'purpose',
  'conflict',
  'twist',
  'emotionalShift',
  'endState',
  'foreshadowing',
  'mood',
  'relationStage',
];

function buildUser(input: StudioAgentPromptInput): string {
  const sections = [
    `[대상] ${entityKindLabel(input.entityKind)} · ${input.entityLabel} (${input.targetFile})`,
    '',
    '[자료]',
    input.context,
  ];

  if (input.conversation.length > 0) {
    sections.push('', '[지금까지의 대화]', input.conversation);
  }

  sections.push('', '[작가의 지시]', input.instruction);

  return sections.join('\n');
}

function entityKindLabel(entityKind: StudioAgentPromptInput['entityKind']): string {
  switch (entityKind) {
    case 'character':
      return '인물 카드';
    case 'background':
      return '배경 카드';
    case 'scene':
      return '씬';
  }
}
