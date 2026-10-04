import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import type { ChoiceRequest } from '@/adapters/prompter';

export interface ChoiceDialogProps {
  readonly request: ChoiceRequest<unknown>;
  // Called once with the chosen option's index, or undefined when the person backs out.
  readonly onAnswer: (index: number | undefined) => void;
}

// The interactive screen's form of a prompter question: the details, numbered options, and the
// same keys the one-shot prompt reads.
export function ChoiceDialog(props: ChoiceDialogProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const optionCount = props.request.options.length;

  useInput((input, key) => {
    const digit = Number.parseInt(input, 10);

    if (key.escape) {
      props.onAnswer(undefined);
    } else if (key.return) {
      props.onAnswer(selectedIndex);
    } else if (key.upArrow || key.downArrow) {
      const step = key.upArrow ? -1 : 1;
      setSelectedIndex((index) => (index + step + optionCount) % optionCount);
    } else if (digit >= 1 && digit <= optionCount) {
      props.onAnswer(digit - 1);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>{props.request.title}</Text>
      {props.request.details.map((detail) => (
        <Text key={detail} color="gray">
          {detail}
        </Text>
      ))}
      <Text> </Text>
      {props.request.options.map((option, index) => (
        <Text key={option.label} color={index === selectedIndex ? 'cyan' : undefined}>
          {index === selectedIndex ? '❯ ' : '  '}
          {index + 1}. {option.label}
        </Text>
      ))}
      <Text color="gray">↑↓ 또는 숫자로 고르고 Enter · Esc 취소</Text>
    </Box>
  );
}
