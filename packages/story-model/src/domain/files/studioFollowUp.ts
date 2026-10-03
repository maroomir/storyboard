import { z } from 'zod';

import { studioEntitySchema, type StudioEntity } from '#model/shared/messaging/studio';

export const studioFollowUpVersion = '1.0.0';

export const studioFollowUpSchema = z.object({
  id: z.string().min(1),
  target: studioEntitySchema,
  origin: studioEntitySchema,
  reason: z.string().min(1),
  instruction: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type StudioFollowUp = z.infer<typeof studioFollowUpSchema>;

const studioFollowUpFileSchema = z.object({
  version: z.literal(studioFollowUpVersion),
  followUps: z.array(studioFollowUpSchema),
});

export type StudioFollowUpFile = z.infer<typeof studioFollowUpFileSchema>;

export function parseStudioFollowUps(rawFile: string): readonly StudioFollowUp[] {
  return studioFollowUpFileSchema.parse(JSON.parse(rawFile)).followUps;
}

export function serializeStudioFollowUps(followUps: readonly StudioFollowUp[]): string {
  const file: StudioFollowUpFile = { version: studioFollowUpVersion, followUps: [...followUps] };

  return `${JSON.stringify(studioFollowUpFileSchema.parse(file), null, 2)}\n`;
}

export function isSameEntity(left: StudioEntity, right: StudioEntity): boolean {
  return left.kind === right.kind && left.key === right.key;
}

export function selectFollowUpsFor(
  followUps: readonly StudioFollowUp[],
  target: StudioEntity,
): readonly StudioFollowUp[] {
  return followUps.filter((followUp) => isSameEntity(followUp.target, target));
}

// NOTE: a follow-up exists to remind the author that one file is now out of step with another, so
// any accepted edit on that file answers it — matching the specific instruction is not the point.
export function resolveFollowUpsFor(
  followUps: readonly StudioFollowUp[],
  target: StudioEntity,
): readonly StudioFollowUp[] {
  return followUps.filter((followUp) => !isSameEntity(followUp.target, target));
}

export function addFollowUps(
  existing: readonly StudioFollowUp[],
  added: readonly StudioFollowUp[],
): readonly StudioFollowUp[] {
  const kept = existing.filter(
    (followUp) =>
      !added.some(
        (candidate) =>
          isSameEntity(candidate.target, followUp.target) &&
          isSameEntity(candidate.origin, followUp.origin),
      ),
  );

  return [...kept, ...added];
}

export function removeFollowUp(
  followUps: readonly StudioFollowUp[],
  id: string,
): readonly StudioFollowUp[] {
  return followUps.filter((followUp) => followUp.id !== id);
}
