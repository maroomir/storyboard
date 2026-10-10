import { z } from 'zod';

import defaultsData from './pipelineDefaults.params.json';

// 생성 파이프라인이 모델을 가리지 않고 쓰는 기본값. 모델별로 재본 값은 modelProfiles.params.json 이
// 이 위에 덮어쓰고, 창작자가 적은 설정이 그보다 앞선다 — 이 파일은 그 층의 맨 아래다.
// 값을 바꾸면 모든 모델의 생성 결과가 함께 움직이므로, 한 모델에서만 관찰한 값은 여기가 아니라
// 모델 프로필에 적는다.

const ratio = z.number().positive().max(1);
const positiveInt = z.number().int().positive();

const pipelineDefaultsSchema = z.object({
  section: z.object({
    // 한 구간을 다시 부르는 횟수.
    retryLimit: z.number().int().nonnegative(),
    // 구간 결과가 이 비율에 못 미치면 분량 미달로 보고 다시 부른다.
    minimumLengthRatio: ratio,
    // 앞 구간을 그대로 옮겨 적었는지 볼 때 비교하는 창의 크기와, 위반으로 보는 누적 글자 수.
    repeatedRunWindow: positiveInt,
    repeatedRunLimit: positiveInt,
  }),
  skeleton: z.object({
    // 최종 목표 중 뼈대에 배분할 비율. 뼈대가 얇으면 살붙임이 감당 못 할 배율을 요구받는다.
    lengthRatio: ratio,
    // 뼈대는 씬에서 가장 비싼 호출이라 기본은 한 번만 다시 부른다.
    retryLimit: z.number().int().nonnegative(),
    minimumLengthRatio: ratio,
  }),
  sceneBreak: z.object({
    // 좌표 비트 사이 시각 차가 이 분 이상이면 장면을 끊는다. 시:분이 읽히지 않으면 시간대 낱말로 본다.
    timeJumpMinutes: positiveInt,
  }),
  dialogue: z.object({
    // 살붙임이 뼈대의 대사를 지웠는지 판정하는 유사도 임계.
    preservedRatio: ratio,
    // 한 대사가 여러 조각으로 갈렸을 때 몇 조각까지 이어 붙여 비교할지.
    splitLimit: positiveInt,
    // 같은 대사가 연달아 몇 번 나오면 되풀이로 보는지.
    repeatedRunLimit: positiveInt,
    // 이보다 짧은 줄은 대사로 세지 않는다. 감탄사 한 마디가 통계를 흔드는 것을 막는다.
    minimumLineLength: positiveInt,
    // 따옴표 안이 이보다 짧으면 대사 추출에서 제외한다.
    minimumQuotedLength: positiveInt,
  }),
  polish: z.object({
    // 대사 다듬기가 뼈대의 몇 배를 넘으면 거부할지.
    lengthLimitRatio: z.number().positive(),
    retryLimit: positiveInt,
  }),
  catchphrase: z.object({
    // 인물 하나의 입버릇이 비트 하나에 나와도 되는 횟수. 넘으면 초안 경고만 낸다.
    perBeatLimit: positiveInt,
  }),
  padding: z.object({
    // 같은 문단을 되풀이한 것으로 보는 유사도 임계와, 그 판정에 넣을 최소 문단 길이.
    paragraphRatio: ratio,
    paragraphMinimumLength: positiveInt,
  }),
  voiceSamples: z.object({
    limit: positiveInt,
    minimumLength: positiveInt,
    maximumLength: positiveInt,
  }),
  context: z.object({
    // 직전 맥락을 압축할 때의 예산.
    condensedMaxChars: positiveInt,
    // 장면 구분자를 줄바꿈 수로 적었을 때 받아들이는 최대 줄 수.
    maxSceneBreakNewlines: positiveInt,
  }),
  // 재시도 후보 중 어느 판을 남길지 재는 저울. 원고를 못 쓰게 만드는 위반이 무겁다.
  violationWeights: z.object({
    cast: positiveInt,
    'foreign-script': positiveInt,
    'dialogue-count': positiveInt,
    'lost-dialogue': positiveInt,
    'repeats-previous': positiveInt,
    repetition: positiveInt,
    'too-long': positiveInt,
    'too-short': positiveInt,
    'scene-breaks': positiveInt,
  }),
});

export type PipelineDefaults = z.infer<typeof pipelineDefaultsSchema>;

export const pipelineDefaults: PipelineDefaults = pipelineDefaultsSchema.parse(defaultsData);
