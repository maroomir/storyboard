import type { UsageAmount } from '@storyboard/story-model';

import { addUsageAmount, emptyUsageAmount, usageAmountOfEntry } from '#engine/domain/files/usageLedger';
import type { IUsageSink } from '#engine/ports/usageSink';

export interface UsageMeterSession {
  reading(): UsageAmount;
  stop(): void;
}

interface ActiveSession {
  amount: UsageAmount;
  readonly onChange?: (reading: UsageAmount) => void;
}

// Counts what one run spends while every record still reaches the host's own sink. A host wraps its
// sink once in its composition root; a run opens a session, reads it, and stops it when done.
export class UsageMeter {
  private readonly sessions = new Set<ActiveSession>();

  public wrap(sink: IUsageSink): IUsageSink {
    return {
      record: async (workspaceRoot, usage): Promise<void> => {
        const amount = usageAmountOfEntry(usage);

        for (const session of this.sessions) {
          session.amount = addUsageAmount(session.amount, amount);
          session.onChange?.(session.amount);
        }

        await sink.record(workspaceRoot, usage);
      },
    };
  }

  public startSession(onChange?: (reading: UsageAmount) => void): UsageMeterSession {
    const session: ActiveSession = { amount: emptyUsageAmount(), ...(onChange ? { onChange } : {}) };
    this.sessions.add(session);

    return {
      reading: () => session.amount,
      stop: () => {
        this.sessions.delete(session);
      },
    };
  }
}

// A limit of 0 means "no limit". Unpriced usage (a local model) cannot exceed a dollar budget.
export function isRunBudgetExceeded(reading: UsageAmount, limitUsd: number): boolean {
  return limitUsd > 0 && reading.costUsd >= limitUsd;
}
