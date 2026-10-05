import type { WorkspaceStatus } from '@storyboard/story-app';

import type { TerminalStream } from '@/terminal/profile';
import { wrapWordsToWidth } from '@/terminal/width';

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

  // Printed data (a draft body, a scene list) is left as it is; a message is a sentence, and the
  // terminal would break it inside a word.
  if (marking.ok && marking.stop === undefined && !marking.isAction) {
    return message;
  }

  const { paint } = stream.theme;
  const [headline = '', ...details] = message.split('\n');
  const markedHeadline =
    marking.stop !== undefined
      ? paint('warning', headline)
      : marking.ok
        ? `${paint('success', '✓')} ${headline}`
        : paint('danger', `✗ ${headline}`);

  return [markedHeadline, ...details]
    .flatMap((line) => wrapWordsToWidth(line, stream.columns))
    .join('\n');
}

// The same step `storyboard status` names, so the hint after a run and the status screen never
// disagree about what comes next.
export function renderNextStep(status: WorkspaceStatus, stream: TerminalStream): string {
  const command = nextStepCommands[status.nextStep];

  if (command === undefined) {
    return '';
  }

  const { paint } = stream.theme;
  const hint = `${paint('muted', '다음 →')}  ${paint('accent', `storyboard ${command}`)}  ${paint('muted', describeNextStep(status))}`;
  return `${wrapWordsToWidth(hint, stream.columns).join('\n')}\n`;
}
