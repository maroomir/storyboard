import { z } from 'zod';

import type { AiProviderId, GenerationKnobs, SectionViolationKind } from '@storyboard/story-model';
import type { PromptTuningOverrides } from '@storyboard/story-ai';
import { sectionViolationKinds } from '@storyboard/story-model';

import { isSectionOutputLimitKnob, knobRegistry, type KnobSpec } from '#sim/knobs/knobRegistry';

export interface Overlay {
  knobs: Record<string, number>;
  note?: string;
  label?: string;
}

export const overlaySchema: z.ZodType<Overlay> = z.object({
  note: z.string().optional(),
  label: z.string().min(1).optional(),
  knobs: z.record(z.string(), z.number()),
});

export interface OverlayApplication {
  readonly tuning: GenerationKnobs;
  readonly sectionOutputLimit?: number;
  readonly promptOverrides: PromptTuningOverrides;
  readonly refusals: readonly string[];
}

function refuseInertKnob(knob: KnobSpec, providerId: AiProviderId): string | undefined {
  if (knob.honouredBy === 'all' || knob.honouredBy.includes(providerId)) {
    return undefined;
  }

  return `${knob.id} 는 ${providerId} 에서 무시됩니다. 스윕해도 아무것도 변하지 않으므로 빼거나 프로바이더를 바꾸세요.`;
}

export function applyOverlay(
  overlay: Overlay,
  providerId: AiProviderId,
  registry: readonly KnobSpec[] = knobRegistry,
): OverlayApplication {
  const refusals: string[] = [];
  const tuning: Record<string, number> = {};
  const promptOverrides: Record<string, { temperature?: number; maxTokens?: number }> = {};
  let sectionOutputLimit: number | undefined;

  for (const [id, value] of Object.entries(overlay.knobs)) {
    const knob: KnobSpec | undefined = registry.find((candidate) => candidate.id === id);

    if (knob === undefined) {
      refusals.push(`${id} 는 모르는 손잡이입니다.`);
      continue;
    }

    if (value < knob.bounds.min || value > knob.bounds.max) {
      refusals.push(`${id} = ${value} 는 범위 밖입니다 (${knob.bounds.min}~${knob.bounds.max}).`);
      continue;
    }

    const inert: string | undefined = refuseInertKnob(knob, providerId);
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

    tuning[id] = value;
  }

  return {
    tuning,
    ...(sectionOutputLimit === undefined ? {} : { sectionOutputLimit }),
    promptOverrides,
    refusals,
  };
}

export function parseOverlay(raw: unknown): Overlay {
  return overlaySchema.parse(raw);
}

export const overlayWeightKinds: readonly SectionViolationKind[] = sectionViolationKinds;
