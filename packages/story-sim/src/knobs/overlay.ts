import { z } from 'zod';

import type { AiProviderId, PromptTuningOverrides } from '@storyboard/story-ai';
import type { SceneGenerationTuning } from '@storyboard/story-pipeline';
import { sectionViolationKinds } from '@storyboard/story-pipeline';

import { isSectionOutputLimitKnob, knobRegistry, type KnobSpec } from '#sim/knobs/knobRegistry';

export const overlaySchema = z.object({
  note: z.string().optional(),
  knobs: z.record(z.string(), z.number()),
});

export type Overlay = z.infer<typeof overlaySchema>;

export interface OverlayApplication {
  readonly tuning: SceneGenerationTuning;
  // tuning 이 아니라 파이프라인 입력의 별도 칸으로 들어간다.
  readonly sectionOutputLimit?: number;
  // 프롬프트 손잡이는 파이프라인 인자가 아니라 promptTuning 덮개로 간다.
  readonly promptOverrides: PromptTuningOverrides;
  // 비어 있지 않으면 첫 AI 호출 전에 멈춘다. 아무것도 못 재는 실행에 예산을 쓰지 않기 위해서다.
  readonly refusals: readonly string[];
}

function refuseInertKnob(knob: KnobSpec, providerId: AiProviderId): string | undefined {
  if (knob.honouredBy === 'all' || knob.honouredBy.includes(providerId)) {
    return undefined;
  }

  return `${knob.id} 는 ${providerId} 에서 무시됩니다. 스윕해도 아무것도 변하지 않으므로 빼거나 프로바이더를 바꾸세요.`;
}

// registry 는 스윕이 손잡이 일부만 쓸 때를 위한 것이다. 기본값은 전체 표다.
export function applyOverlay(
  overlay: Overlay,
  providerId: AiProviderId,
  registry: readonly KnobSpec[] = knobRegistry,
): OverlayApplication {
  const refusals: string[] = [];
  const tuning: Record<string, unknown> = {};
  const weights: Record<string, number> = {};
  const promptOverrides: Record<string, { temperature?: number; maxTokens?: number }> = {};
  let sectionOutputLimit: number | undefined;

  for (const [id, value] of Object.entries(overlay.knobs)) {
    const knob = registry.find((candidate) => candidate.id === id);

    if (knob === undefined) {
      refusals.push(`${id} 는 모르는 손잡이입니다.`);
      continue;
    }

    if (value < knob.bounds.min || value > knob.bounds.max) {
      refusals.push(`${id} = ${value} 는 범위 밖입니다 (${knob.bounds.min}~${knob.bounds.max}).`);
      continue;
    }

    const inert = refuseInertKnob(knob, providerId);
    if (inert !== undefined) {
      refusals.push(inert);
      continue;
    }

    if (isSectionOutputLimitKnob(knob)) {
      sectionOutputLimit = value;
      continue;
    }

    if (knob.promptKey !== undefined && knob.promptField !== undefined) {
      promptOverrides[knob.promptKey] = {
        ...promptOverrides[knob.promptKey],
        [knob.promptField]: value,
      };
      continue;
    }

    if (knob.weightKind !== undefined) {
      weights[knob.weightKind] = value;
      continue;
    }

    if (knob.tuningKey !== undefined) {
      tuning[knob.tuningKey] = value;
    }
  }

  if (Object.keys(weights).length > 0) {
    tuning['violationWeights'] = weights;
  }

  return {
    tuning: tuning as SceneGenerationTuning,
    ...(sectionOutputLimit === undefined ? {} : { sectionOutputLimit }),
    promptOverrides,
    refusals,
  };
}

export function parseOverlay(raw: unknown): Overlay {
  return overlaySchema.parse(raw);
}

// 저울 키가 파이프라인의 위반 종류와 어긋나면 오버레이가 조용히 무시된다.
export const overlayWeightKinds = sectionViolationKinds;
