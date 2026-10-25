import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import type { ChoiceRequest } from '@/adapters/prompter';
import { useTuiTheme, type TuiTheme } from './tuiTheme';

export interface ChoiceDialogProps {
  readonly request: ChoiceRequest<unknown>;
  readonly onAnswer: (index: number | undefined) => void;
}

export function ChoiceDialog(props: ChoiceDialogProps): React.ReactElement {
  const theme: TuiTheme = useTuiTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const optionCount: number = props.request.options.length;

  useInput((input, key) => {
    const digit: number = Number.parseInt(input, 10);

    if (key.escape) {
      props.onAnswer(undefined);
    } else if (key.return) {
      props.onAnswer(selectedIndex);
    } else if (key.upArrow || key.downArrow) {
      const step: number = key.upArrow ? -1 : 1;
      setSelectedIndex((index) => (index + step + optionCount) % optionCount);
    } else if (digit >= 1 && digit <= optionCount) {
      props.onAnswer(digit - 1);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text bold>{props.request.title}</Text>
      {props.request.details.map((detail) => (
        <Text key={detail} color={theme.muted}>
          {detail}
        </Text>
      ))}
      <Text> </Text>
      {props.request.options.map((option, index) => (
        <Text key={option.label} color={index === selectedIndex ? theme.accent : undefined}>
          {index === selectedIndex ? '❯ ' : '  '}
          {index + 1}. {option.label}
        </Text>
      ))}
      <Text color={theme.muted}>↑↓ 또는 숫자로 고르고 Enter · Esc 취소</Text>
    </Box>
  );
}
