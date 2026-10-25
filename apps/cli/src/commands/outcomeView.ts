import type { WorkspaceStatus } from '@storyboard/story-app';

import type { TerminalStream } from '@/terminal/profile';
import { wrapWordsToWidth } from '@/terminal/width';

import { describeNextStep, nextStepCommands } from './status';

export interface OutcomeMarking {
  readonly ok: boolean;
  readonly stop?: 'paused' | 'cancelled';
  readonly isDrawn?: boolean;
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

  if (marking.ok && marking.stop === undefined && !marking.isAction) {
    return message;
  }

  const { paint } = stream.theme;
  const [headline = '', ...details] = message.split('\n');
  const markedHeadline: string =
    marking.stop !== undefined
      ? paint('warning', headline)
      : marking.ok
        ? `${paint('success', '✓')} ${headline}`
        : paint('danger', `✗ ${headline}`);

  return [markedHeadline, ...details]
    .flatMap((line) => wrapWordsToWidth(line, stream.columns))
    .join('\n');
}

export function renderNextStep(status: WorkspaceStatus, stream: TerminalStream): string {
  const command: string | undefined = nextStepCommands[status.nextStep];

  if (command === undefined) {
    return '';
  }

  const { paint } = stream.theme;
  const hint: string = `${paint('muted', '다음 →')}  ${paint('accent', `storyboard ${command}`)}  ${paint('muted', describeNextStep(status))}`;
  return `${wrapWordsToWidth(hint, stream.columns).join('\n')}\n`;
}
