import type { WorkspaceStatus } from '@storyboard/story-app';
import { Box, Text } from 'ink';
import React from 'react';

import { describeNextStep, nextStepCommands } from '@/commands/status';
import { useTuiTheme } from './tuiTheme';

const progressBarWidth = 24;

export interface DashboardProps {
  readonly status: WorkspaceStatus;
}

// Fresh drafts over scenes: a draft older than its card does not count as done.
export function describeDraftProgress(status: WorkspaceStatus): {
  readonly done: number;
  readonly total: number;
  readonly bar: string;
} {
  const total = status.scenes.total;
  const done = Math.min(status.drafts.ready, total);
  const filled = total === 0 ? 0 : Math.round((done / total) * progressBarWidth);

  return { done, total, bar: `${'█'.repeat(filled)}${'░'.repeat(progressBarWidth - filled)}` };
}

function describeManuscript({ manuscript }: WorkspaceStatus): string {
  if (!manuscript.isAssembled) {
    return '조립 전';
  }

  return manuscript.isStale
    ? '조립됨 (초안보다 오래됨)'
    : manuscript.isReviewed
      ? '검사함'
      : '조립됨';
}

// The home screen: how far the work is, and the one command that moves it forward — the same step
// `storyboard status` names, written as it is typed at this prompt.
export function Dashboard({ status }: DashboardProps): React.ReactElement {
  const theme = useTuiTheme();
  const progress = describeDraftProgress(status);
  const command = nextStepCommands[status.nextStep];
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.muted} paddingX={1}>
      <Text bold>{status.project.name}</Text>
      <Text>
        씬 {status.scenes.total} · 초안 {progress.done}/{progress.total}
        {status.drafts.stale > 0 ? (
          <Text color={theme.warning}> (오래됨 {status.drafts.stale})</Text>
        ) : null}
        {' · '}인물 {status.cards.characters} · 배경 {status.cards.backgrounds} · 원고{' '}
        {describeManuscript(status)}
      </Text>
      <Text>
        <Text color={theme.accent}>{progress.bar}</Text> {percent}%
      </Text>
      {command === undefined ? (
        <Text color={theme.success}>{describeNextStep(status)}</Text>
      ) : (
        <Text>
          <Text color={theme.muted}>다음 </Text>
          <Text color={theme.accent}>{command}</Text>
          <Text color={theme.muted}> — {describeNextStep(status)}</Text>
        </Text>
      )}
    </Box>
  );
}
