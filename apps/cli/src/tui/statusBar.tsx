import { Box, Text } from 'ink';
import React from 'react';

import type { WorkspaceView } from './workspaceView';
import { useTuiTheme, type TuiTheme } from './tuiTheme';

export interface StatusBarProps {
  readonly view: WorkspaceView;
  readonly isBusy: boolean;
  readonly columns: number;
  readonly escapeHint?: string;
}

const fullKeyHintColumns: number = 72;

function describeKeyHint(props: StatusBarProps): string {
  if (props.isBusy) {
    return props.escapeHint ?? '';
  }
  return props.columns >= fullKeyHintColumns
    ? '/help 도움말 · Ctrl+R 기록 · Ctrl+C 나가기'
    : '/help 도움말';
}

export function StatusBar(props: StatusBarProps): React.ReactElement {
  const theme: TuiTheme = useTuiTheme();
  const { header, lockHolder } = props.view;
  const keyHint: string = describeKeyHint(props);

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={theme.muted} wrap="truncate-end">
        {header.workspaceLabel}
        {' · '}
        {props.isBusy ? (
          <Text color={theme.accent}>실행 중</Text>
        ) : lockHolder === undefined ? (
          '쓰기 가능'
        ) : (
          <Text color={theme.warning}>{lockHolder}</Text>
        )}
        {' · '}
        {header.providerLabel}
      </Text>
      {keyHint.length === 0 ? null : (
        <Box flexShrink={0} marginLeft={2}>
          <Text color={theme.muted}>{keyHint}</Text>
        </Box>
      )}
    </Box>
  );
}
