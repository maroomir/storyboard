import { Box, Text } from 'ink';
import React from 'react';

import type { WorkspaceView } from './workspaceView';
import { useTuiTheme } from './tuiTheme';

export interface StatusBarProps {
  readonly view: WorkspaceView;
  readonly isBusy: boolean;
}

// The line under the prompt: which work, whether it can be written now, which AI answers, and the
// keys that matter, on one line: the left side is cut before the keys are. Another app holding the
// run lock is the one state worth a color.
export function StatusBar(props: StatusBarProps): React.ReactElement {
  const theme = useTuiTheme();
  const { header, lockHolder } = props.view;

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
      <Box flexShrink={0} marginLeft={2}>
        <Text color={theme.muted}>
          {props.isBusy ? 'Esc 씬 경계에서 멈춤' : '/help 도움말 · Ctrl+R 기록 · Ctrl+C 나가기'}
        </Text>
      </Box>
    </Box>
  );
}
