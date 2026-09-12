import { z } from 'zod';

import defaultsData from './simDefaults.params.json';

// 시뮬레이터 자신의 손잡이. 생성 파이프라인이 아니라 «재는 쪽»의 값이라 제품 기본값과 섞지 않는다.

const positiveInt = z.number().int().positive();

const pricePerMillion = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
});

const simDefaultsSchema = z.object({
  panel: z.object({
    // AUC 를 내는 공통 독자 수. 장르 독자는 여기 포함되지 않는다.
    commonReaderCount: positiveInt,
    // 독자가 씬마다 매기는 몰입도의 상한. 이 값으로 나눠 0~1 가중치가 된다.
    engagementScaleMax: positiveInt,
    // 인용이 본문의 실제 부분 문자열이 아닐 때 다시 물어보는 횟수.
    quoteRetryLimit: z.number().int().nonnegative(),
  }),
  run: z.object({
    // 씨앗이 없어 재현이 안 되므로 같은 지점을 몇 번 돌려 중앙값을 쓸지.
    repeats: positiveInt,
    // 트랙 한 벌의 씬 수. 원장의 회수 칸 수와 함께 리포트의 분모가 된다.
    sceneCount: positiveInt,
  }),
  // NOTE: 구독형 CLI 는 토큰당 과금이 아니라서 제품의 가격표가 비어 있다. 지점끼리 비교할 공통
  // 잣대가 필요하므로 여기서 참조 단가를 갖되, 출력할 때는 반드시 (ref) 를 붙여 실제 청구액과
  // 구분한다. 제품의 storyboardModelPricing 과는 목적이 달라 합치지 않는다.
  referencePricePerMillion: z.record(z.string(), pricePerMillion),
});

export type SimDefaults = z.infer<typeof simDefaultsSchema>;

export const simDefaults: SimDefaults = simDefaultsSchema.parse(defaultsData);
