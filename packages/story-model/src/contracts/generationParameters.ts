import { sectionViolationKinds } from './sectionViolationKinds';

export type GenerationParameterKind = 'ratio' | 'count' | 'chars' | 'weight';

export interface GenerationParameterBounds {
  readonly min: number;
  readonly max: number;
}

export interface GenerationParameterDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: GenerationParameterKind;
  readonly bounds: GenerationParameterBounds;
}

const ratioBounds: GenerationParameterBounds = { min: 0.05, max: 1 };

const weightParameters: readonly GenerationParameterDefinition[] = sectionViolationKinds.map(
  (kind) => ({
    id: `generation.violationWeights.${kind}`,
    label: `재시도 저울: ${kind}`,
    kind: 'weight',
    bounds: { min: 1, max: 10 },
  }),
);

export const generationParameterCatalog: readonly GenerationParameterDefinition[] = [
  {
    id: 'generation.section.retryLimit',
    label: '구간 재시도 횟수',
    kind: 'count',
    bounds: { min: 0, max: 4 },
  },
  {
    id: 'generation.section.minimumLengthRatio',
    label: '구간 분량 하한 비율',
    kind: 'ratio',
    bounds: ratioBounds,
  },
  {
    id: 'generation.section.repeatedRunWindow',
    label: '구간 되풀이 비교 창',
    kind: 'chars',
    bounds: { min: 20, max: 400 },
  },
  {
    id: 'generation.section.repeatedRunLimit',
    label: '구간 되풀이 허용 글자 수',
    kind: 'chars',
    bounds: { min: 50, max: 1200 },
  },
  {
    id: 'generation.section.recapPhraseLimit',
    label: '구간 되짚기 표현 허용 횟수',
    kind: 'count',
    bounds: { min: 0, max: 20 },
  },
  {
    id: 'generation.skeleton.lengthRatio',
    label: '뼈대 분량 비율',
    kind: 'ratio',
    bounds: ratioBounds,
  },
  {
    id: 'generation.skeleton.retryLimit',
    label: '뼈대 재시도 횟수',
    kind: 'count',
    bounds: { min: 0, max: 3 },
  },
  {
    id: 'generation.skeleton.minimumLengthRatio',
    label: '뼈대 분량 하한 비율',
    kind: 'ratio',
    bounds: ratioBounds,
  },
  {
    id: 'generation.skeleton.thinDialogueTurns',
    label: '짧은 설전으로 보는 사건당 대사 수',
    kind: 'count',
    bounds: { min: 1, max: 10 },
  },
  {
    id: 'generation.skeleton.requestedDialogueTurns',
    label: '짧은 설전에 요구하는 대사 턴 수',
    kind: 'count',
    bounds: { min: 2, max: 20 },
  },
  {
    id: 'generation.skeleton.charsPerCall',
    label: '뼈대 호출 하나의 목표 글자 수 상한',
    kind: 'chars',
    bounds: { min: 500, max: 50000 },
  },
  {
    id: 'generation.sceneBreak.timeJumpMinutes',
    label: '장면 전환으로 보는 시각 차(분)',
    kind: 'count',
    bounds: { min: 10, max: 360 },
  },
  {
    id: 'generation.dialogue.preservedRatio',
    label: '대사 보존 유사도',
    kind: 'ratio',
    bounds: ratioBounds,
  },
  {
    id: 'generation.dialogue.splitLimit',
    label: '대사 조각 이어 붙이기 한도',
    kind: 'count',
    bounds: { min: 1, max: 6 },
  },
  {
    id: 'generation.dialogue.repeatedRunLimit',
    label: '같은 대사 되풀이 한도',
    kind: 'count',
    bounds: { min: 2, max: 8 },
  },
  {
    id: 'generation.dialogue.minimumLineLength',
    label: '대사로 세는 최소 길이',
    kind: 'chars',
    bounds: { min: 2, max: 30 },
  },
  {
    id: 'generation.dialogue.minimumQuotedLength',
    label: '따옴표 안 최소 길이',
    kind: 'chars',
    bounds: { min: 2, max: 30 },
  },
  {
    id: 'generation.polish.lengthLimitRatio',
    label: '대사 다듬기 분량 상한 배율',
    kind: 'ratio',
    bounds: { min: 1, max: 5 },
  },
  {
    id: 'generation.polish.retryLimit',
    label: '대사 다듬기 재시도 횟수',
    kind: 'count',
    bounds: { min: 1, max: 4 },
  },
  {
    id: 'generation.catchphrase.perBeatLimit',
    label: '비트당 입버릇 상한',
    kind: 'count',
    bounds: { min: 1, max: 5 },
  },
  {
    id: 'generation.actors.retryLimit',
    label: '배우 뼈대 재합침 횟수',
    kind: 'count',
    bounds: { min: 0, max: 3 },
  },
  {
    id: 'generation.actors.lineMaxChars',
    label: '배우 대사 한 줄 글자 상한',
    kind: 'chars',
    bounds: { min: 30, max: 300 },
  },
  {
    id: 'generation.actors.lineMaxSentences',
    label: '배우 대사 한 줄 문장 상한',
    kind: 'count',
    bounds: { min: 1, max: 5 },
  },
  {
    id: 'generation.padding.paragraphRatio',
    label: '문단 되풀이 유사도',
    kind: 'ratio',
    bounds: ratioBounds,
  },
  {
    id: 'generation.padding.paragraphMinimumLength',
    label: '되풀이 판정 최소 문단 길이',
    kind: 'chars',
    bounds: { min: 10, max: 200 },
  },
  {
    id: 'generation.voiceSamples.limit',
    label: '목소리 표본 개수',
    kind: 'count',
    bounds: { min: 1, max: 12 },
  },
  {
    id: 'generation.voiceSamples.minimumLength',
    label: '목소리 표본 최소 길이',
    kind: 'chars',
    bounds: { min: 2, max: 40 },
  },
  {
    id: 'generation.voiceSamples.maximumLength',
    label: '목소리 표본 최대 길이',
    kind: 'chars',
    bounds: { min: 20, max: 200 },
  },
  {
    id: 'generation.context.condensedMaxChars',
    label: '직전 맥락 압축 예산',
    kind: 'chars',
    bounds: { min: 200, max: 8000 },
  },
  ...weightParameters,
];

export const generationParameterIds: readonly string[] = generationParameterCatalog.map(
  (definition) => definition.id,
);

export function findGenerationParameter(id: string): GenerationParameterDefinition | undefined {
  return generationParameterCatalog.find((definition) => definition.id === id);
}

export const sectionOutputLimitParameterId: string = 'generation.section.outputLimit';

export const modelProfileKnobIds: readonly string[] = [
  ...generationParameterIds,
  sectionOutputLimitParameterId,
];

export type GenerationKnobs = Readonly<Partial<Record<string, number>>>;
