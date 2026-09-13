import { readFile } from 'node:fs/promises';

import { z } from 'zod';

// NOTE: 어느 모델로 쓰고 어느 모델로 채점할지는 기계의 성질이다. 5070 한 대와 API 키 한 벌은 다른
// 답을 갖는다. 그래서 이 값은 시험체(트랙 디렉터리)의 .storyboard/config.json 이 아니라 트랙
// 저장소 루트의 파일 하나에 둔다 — 시험체는 기계가 바뀌어도 그대로여야 한다.

const selectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

export const simConfigSchema = z.object({
  generation: selectionSchema.optional(),
  judge: selectionSchema.optional(),
  ollama: z
    .object({
      baseUrl: z.string().min(1).optional(),
      contextTokens: z.number().int().positive().optional(),
    })
    .optional(),
  repeats: z.number().int().positive().optional(),
});

export type SimConfig = z.infer<typeof simConfigSchema>;

export const simConfigFileName = 'sim.config.json';

export function parseSimConfig(raw: unknown): SimConfig {
  return simConfigSchema.parse(raw);
}

// 파일이 없으면 빈 설정이다. 명령줄 플래그와 홈 설정만으로도 돌 수 있어야 한다.
export async function readSimConfig(filePath: string): Promise<SimConfig> {
  let raw: string;

  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return {};
  }

  return parseSimConfig(JSON.parse(raw));
}
