import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import type { TextRequest } from '@/adapters/prompter';

export interface TextDialogProps {
  readonly request: TextRequest;
  // The typed line, trimmed, or undefined when the person backs out with Esc.
  readonly onAnswer: (answer: string | undefined) => void;
}

export function TextDialog(props: TextDialogProps): React.ReactElement {
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
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text>
        <Text color="cyan">◆ </Text>
        <Text bold>{props.request.title}</Text>
        {props.request.hint === undefined ? null : (
          <Text color="gray"> ({props.request.hint})</Text>
        )}
      </Text>
      <Text>
        › {value}
        <Text inverse> </Text>
      </Text>
      <Text color="gray">Enter 확정 · Esc 취소</Text>
    </Box>
  );
}
