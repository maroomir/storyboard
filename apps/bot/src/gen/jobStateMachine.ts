import type { JobState } from './types';

export type JobTransitionEvent =
  | 'start'
  | 'succeed'
  | 'fail'
  | 'cancel'
  | 'interrupt'
  | 'boot_interrupt';

const ALLOWED_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'interrupted'],
  succeeded: [],
  failed: [],
  interrupted: [],
  cancelled: [],
};

export class JobStateMachine {
  public assertAllowed(from: JobState, to: JobState): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new Error(`invalid job transition: ${from} -> ${to}`);
    }
  }

  public transit(from: JobState, event: JobTransitionEvent): JobState {
    const to = resolveTargetState(from, event);
    this.assertAllowed(from, to);
    return to;
  }
}

function resolveTargetState(from: JobState, event: JobTransitionEvent): JobState {
  switch (event) {
    case 'start':
      return 'running';
    case 'succeed':
      return 'succeeded';
    case 'fail':
      return 'failed';
    case 'cancel':
      return 'cancelled';
    case 'interrupt':
    case 'boot_interrupt':
      return from === 'running' ? 'interrupted' : from;
    default: {
      const exhaustive: never = event;
      throw new Error(`unknown transition event: ${exhaustive}`);
    }
  }
}
