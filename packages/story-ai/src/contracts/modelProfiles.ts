import { z } from 'zod';

import profileData from './modelProfiles.json';

// NOTE: 모델마다 «한 번 호출에 쓰는 양»과 «같은 말을 되풀이하는 성향»이 다르다. 그 차이를 코드
// 상수로 두면 모델을 바꿀 때마다 파이프라인을 고쳐야 하므로, 실측으로 정한 값만 여기 모은다.
// 재보지 않은 모델은 **키 자체가 없다** — 그러면 파이프라인의 일반 기본값이 그대로 쓰이고,
// doctor 도 아무 말 하지 않는다. 추측한 값을 기본값으로 주는 것이 가장 나쁘다.

// 값이 어디서 왔는지 없으면 반년 뒤에 아무도 손대지 못한다. 모델이 바뀌었을 때 «다시 재야 할
// 항목»을 이 블록으로 가려낸다.
const measurementSchema = z.object({
  date: z.string().min(1),
  workspace: z.string().min(1),
  // 이 실측이 대표하는 씬 목표 분량.
  sceneTarget: z.number().int().positive(),
  runs: z.number().int().positive(),
  // 목표 대비 실제 초안 분량의 비. doctor 가 모델·목표 부적합을 판정하는 근거.
  reach: z.number().positive(),
  // 뼈대 → 초안 팽창 배율. skeletonRatio 를 정하는 근거.
  expansionRatio: z.number().positive().optional(),
});

// 파이프라인이 모델마다 달리 잡을 수 있는 손잡이. 전부 선택이며, 없으면 파이프라인 기본값을 쓴다.
const modelProfileSchema = z.object({
  // 한 번의 살붙임 호출이 낼 수 있는 최대 글자 수. 목표를 이 값으로 나눠 구간 수가 정해진다.
  sectionOutputLimit: z.number().int().positive().optional(),
  // 최종 목표 중 뼈대에 배분할 비율. 살붙임 배율이 낮은 모델일수록 뼈대를 두껍게 잡아야 한다.
  skeletonRatio: z.number().positive().max(1).optional(),
  // 뼈대·살붙임 호출의 출력 천장. sectionOutputLimit 을 이보다 크게 잡아도 그만큼 나오지 않는다.
  skeletonMaxTokens: z.number().int().positive().optional(),
  sectionMaxTokens: z.number().int().positive().optional(),
  // 살붙임이 뼈대의 대사를 지웠는지 판정하는 유사도 임계. 문체가 다른 모델은 같은 대사를 다르게
  // 옮기므로 임계가 맞지 않으면 오탐으로 재시도를 태운다.
  dialoguePreservedRatio: z.number().positive().max(1).optional(),
  // 같은 문단을 되풀이한 것으로 보는 유사도 임계.
  paddingParagraphRatio: z.number().positive().max(1).optional(),
  // 대사 다듬기가 뼈대의 몇 배를 넘으면 거부할지.
  polishLengthLimitRatio: z.number().positive().optional(),
  skeletonRetryLimit: z.number().int().nonnegative().optional(),
  sectionRetryLimit: z.number().int().nonnegative().optional(),
  measured: measurementSchema.optional(),
});

export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelMeasurement = z.infer<typeof measurementSchema>;

const modelProfilesSchema = z.record(z.string(), modelProfileSchema);

const modelProfiles = modelProfilesSchema.parse(profileData);

export function modelProfileKey(providerId: string, model: string | undefined): string {
  return `${providerId}:${model ?? ''}`;
}

// 재보지 않은 조합이면 undefined. 호출자는 그 경우 자기 기본값을 써야 한다.
export function findModelProfile(
  providerId: string,
  model: string | undefined,
): ModelProfile | undefined {
  return modelProfiles[modelProfileKey(providerId, model)];
}
