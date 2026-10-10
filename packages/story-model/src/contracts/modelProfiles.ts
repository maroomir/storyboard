import { z } from 'zod';

import profileData from './modelProfiles.params.json';

import { modelProfileKnobIds } from './generationParameters';

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
  // 이 실측이 돈 구간 수. 같은 상한이라도 목표가 다르면 구간 수가 달라지므로 함께 남긴다.
  sections: z.number().int().positive().optional(),
  // 후보값을 왜 떨어뜨렸는지. 같은 스윕을 다시 돌리지 않게 근거를 남긴다.
  skeletonRatioCandidates: z.string().optional(),
  // sim apply 가 함께 적는 심판 지표. 독자 이탈 곡선 면적과 사실 회수, 그리고 누가 채점했는지.
  auc: z.number().min(0).max(1).optional(),
  recalled: z.number().nonnegative().optional(),
  judge: z.string().optional(),
  // 다른 손잡이의 근거. 어느 값이 어느 실측에서 왔는지 적는다.
  notes: z.string().optional(),
});

export type ModelMeasurement = z.infer<typeof measurementSchema>;

// A profile is the measured knobs, keyed by their public `generation.*` id, plus where the numbers
// came from. Every knob is optional; a missing one means the pipeline default. A key the generation
// catalog does not know is refused, so a renamed knob cannot linger as a silently ignored value.
export interface ModelProfile {
  readonly knobs: Readonly<Record<string, number>>;
  readonly measured?: ModelMeasurement;
}

const modelProfileSchema = z
  .object({ measured: measurementSchema.optional() })
  .catchall(z.number())
  .superRefine((profile, context) => {
    for (const key of Object.keys(profile)) {
      if (key !== 'measured' && !modelProfileKnobIds.includes(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `모델 프로필이 모르는 손잡이를 담고 있습니다: ${key}`,
        });
      }
    }
  })
  .transform(
    ({ measured, ...knobs }): ModelProfile => ({
      knobs: knobs as Record<string, number>,
      ...(measured === undefined ? {} : { measured }),
    }),
  );

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
