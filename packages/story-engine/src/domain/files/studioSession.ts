import { z } from 'zod';

import {
  studioChatTurnSchema,
  studioEntitySchema,
  type StudioChatTurn,
  type StudioEntity,
  type StudioSessionSummary,
} from '#engine/shared/messaging/studio';

export const studioSessionVersion = '2.0.0';

const studioSessionTitleFallback = '새 대화';
const studioSessionTitleMaxLength = 40;

export interface StudioSession {
  readonly version: typeof studioSessionVersion;
  readonly id: string;
  readonly entity: StudioEntity;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly title: string;
  readonly hasAppliedChanges: boolean;
  readonly turns: readonly StudioChatTurn[];
}

const studioSessionSchema = z.object({
  version: z.literal(studioSessionVersion),
  id: z.string().min(1),
  entity: studioEntitySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  title: z.string(),
  hasAppliedChanges: z.boolean(),
  turns: z.array(studioChatTurnSchema),
});

export function parseStudioSession(rawSession: string): StudioSession {
  return studioSessionSchema.parse(JSON.parse(rawSession));
}

export function serializeStudioSession(session: StudioSession): string {
  return `${JSON.stringify(studioSessionSchema.parse(session), null, 2)}\n`;
}

export function deriveStudioSessionTitle(turns: readonly StudioChatTurn[]): string {
  const firstUserTurn = turns.find((turn) => turn.role === 'user');
  const text = firstUserTurn?.role === 'user' ? firstUserTurn.text.trim() : '';

  if (text.length === 0) {
    return studioSessionTitleFallback;
  }

  return text.length > studioSessionTitleMaxLength
    ? `${text.slice(0, studioSessionTitleMaxLength)}…`
    : text;
}

export type PrunableStudioSession = Pick<StudioSessionSummary, 'id' | 'updatedAt'> &
  Pick<StudioSession, 'hasAppliedChanges'>;

// NOTE: a session whose proposal was applied is a record of what changed in the workspace, so it
// is kept for good; only sessions that never touched a file age out.
export function selectSessionsToPrune(
  sessions: readonly PrunableStudioSession[],
  keep = 10,
): readonly string[] {
  return sessions
    .filter((session) => !session.hasAppliedChanges)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(keep)
    .map((session) => session.id);
}
