import { z } from 'zod';

import {
  studioChatTurnSchema,
  type StudioChatTurn,
  type StudioSessionSummary,
} from '../../shared/messaging/studio';

export const studioSessionVersion = '1.0.0';

const studioSessionTitleFallback = '새 대화';
const studioSessionTitleMaxLength = 40;

export interface StudioSession {
  readonly version: typeof studioSessionVersion;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly title: string;
  readonly turns: readonly StudioChatTurn[];
}

const studioSessionSchema = z.object({
  version: z.literal(studioSessionVersion),
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  title: z.string(),
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

export function selectSessionsToPrune(
  summaries: readonly Pick<StudioSessionSummary, 'id' | 'updatedAt'>[],
  keep = 20,
): readonly string[] {
  return [...summaries]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(keep)
    .map((summary) => summary.id);
}
