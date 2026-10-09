import { sectionViolationKinds } from './sectionViolationKinds';

// The scene generation knobs a model profile or a measurement sweep may move, by their public id.
// Ids read `generation.<group>.<property>`, the same path the value has in the pipeline's defaults
// file, so one name serves the config, the model profile, the sweep and the report. The default
// values themselves live in `story-engine/src/pipeline/pipelineDefaults.params.json`; this table owns the
// identity, the unit and the range.
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
  // NOTE: 뼈대·구간은 attempt <= retryLimit 로 돌고 다듬기만 < 로 돈다. 같은 숫자가 호출을 하나 덜
  // 부르므로 두 계열의 재시도 한도를 나란히 비교하지 않는다.
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

// The one setting a model profile may also carry: it is a user setting first, so it is not in the
// generation catalog, but a measured model may say what it can output per call.
export const sectionOutputLimitParameterId = 'generation.section.outputLimit';

export const modelProfileKnobIds: readonly string[] = [
  ...generationParameterIds,
  sectionOutputLimitParameterId,
];

// A partial set of generation knobs keyed by id — what a model profile, a sweep overlay or a host
// hands the pipeline over its defaults.
export type GenerationKnobs = Readonly<Partial<Record<string, number>>>;
