import type { UsageAmount } from '@storyboard/story-model';

import { addUsageAmount, emptyUsageAmount, usageAmountOfEntry } from '@storyboard/story-model';
import type { IUsageSink } from '#engine/ports/usageSink';

export interface UsageMeterSession {
  reading(): UsageAmount;
  stop(): void;
}

interface ActiveSession {
  amount: UsageAmount;
  readonly onChange?: (reading: UsageAmount) => void;
}

export class UsageMeter {
  private readonly sessions: Set<ActiveSession> = new Set<ActiveSession>();

  public wrap(sink: IUsageSink): IUsageSink {
    return {
      record: async (workspaceRoot, usage): Promise<void> => {
        const amount: UsageAmount = usageAmountOfEntry(usage);

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
      stop: (): void => {
        this.sessions.delete(session);
      },
    };
  }
}

export function isRunBudgetExceeded(reading: UsageAmount, limitUsd: number): boolean {
  return limitUsd > 0 && reading.costUsd >= limitUsd;
}
