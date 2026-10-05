import type { WorkspaceStatus } from '@storyboard/story-app';

import type { TerminalStream } from '@/terminal/profile';

import { describeNextStep, nextStepCommands } from './status';

// 사람이 읽는 터미널에서만 결과에 표시를 붙인다. 파이프로 받는 쪽은 지금까지와 같은 글자를 받는다.

export interface OutcomeMarking {
  readonly ok: boolean;
  readonly stop?: 'paused' | 'cancelled';
  readonly isDrawn?: boolean;
  // A verb that changed the work earns a check mark; one that only printed something (a draft
  // body, a scene list) does not, since a mark in front of data reads as part of it.
  readonly isAction: boolean;
}

export function markOutcome(
  message: string,
  marking: OutcomeMarking,
  stream: TerminalStream,
): string {
  if (!stream.isTty || message.length === 0 || marking.isDrawn === true) {
    return message;
  }

  const { paint } = stream.theme;
  const [headline = '', ...details] = message.split('\n');

  if (marking.stop !== undefined) {
    return [paint('warning', headline), ...details].join('\n');
  }

  if (!marking.ok) {
    return [paint('danger', `✗ ${headline}`), ...details].join('\n');
  }

  return marking.isAction
    ? [`${paint('success', '✓')} ${headline}`, ...details].join('\n')
    : message;
}

// The same step `storyboard status` names, so the hint after a run and the status screen never
// disagree about what comes next.
export function renderNextStep(status: WorkspaceStatus, stream: TerminalStream): string {
  const command = nextStepCommands[status.nextStep];

  if (command === undefined) {
    return '';
  }

  const { paint } = stream.theme;
  return `${paint('muted', '다음 →')}  ${paint('accent', `storyboard ${command}`)}  ${paint('muted', describeNextStep(status))}\n`;
}
