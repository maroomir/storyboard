import type { CommandOutcome } from '@/commands/outcome';

export function describeNothingToPromote(kind: 'no_candidates' | 'no_new_candidates'): string {
  return kind === 'no_candidates' ? '승격할 후보가 없습니다.' : '후보가 모두 이미 반영돼 있습니다.';
}

export interface CommandFailure extends CommandOutcome {
  readonly ok: false;
}

export interface CommandSuccess extends CommandOutcome {
  readonly ok: true;
}

export function failure(message: string, data?: unknown): CommandFailure {
  return data === undefined ? { ok: false, message } : { ok: false, message, data };
}

export function success(message: string, data?: unknown): CommandSuccess {
  return data === undefined ? { ok: true, message } : { ok: true, message, data };
}
