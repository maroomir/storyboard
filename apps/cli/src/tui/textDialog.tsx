import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import type { TextRequest } from '@/adapters/prompter';
import { useTuiTheme, type TuiTheme } from '@/tui/tuiTheme';

export interface TextDialogProps {
  readonly request: TextRequest;
  readonly onAnswer: (answer: string | undefined) => void;
}

export function TextDialog(props: TextDialogProps): React.ReactElement {
  const theme: TuiTheme = useTuiTheme();
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      props.onAnswer(undefined);
    } else if (key.return) {
      props.onAnswer(value.trim());
    } else if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
    } else if (input.length > 0 && !key.ctrl && !key.meta) {
      setValue((current) => current + input);
    }
  });

  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1} flexDirection="column">
      <Text>
        <Text color={theme.accent}>◆ </Text>
        <Text bold>{props.request.title}</Text>
        {props.request.hint === undefined ? null : (
          <Text color={theme.muted}> ({props.request.hint})</Text>
        )}
      </Text>
      <Text>
        › {value}
        <Text inverse> </Text>
      </Text>
      <Text color={theme.muted}>Enter 확정 · Esc 취소</Text>
    </Box>
  );
}
