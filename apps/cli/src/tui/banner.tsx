import { Box, Text } from 'ink';
import React from 'react';

import { canShowWordmark, storyboardTagline, storyboardWordmark } from '@/terminal/banner';

export interface BannerProps {
  readonly version: string;
  readonly columns: number;
}

// The wordmark when it fits, otherwise one bold line: a narrow terminal still knows what it opened.
export function Banner(props: BannerProps): React.ReactElement {
  if (!canShowWordmark(props.columns)) {
    return (
      <Box paddingX={1}>
        <Text>
          <Text bold color="cyan">
            Storyboard
          </Text>
          <Text color="gray">
            {' '}
            {props.version} · {storyboardTagline}
          </Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      {storyboardWordmark.map((line) => (
        <Text key={line} color="cyan">
          {line}
        </Text>
      ))}
      <Text color="gray">
        {props.version} · {storyboardTagline}
      </Text>
    </Box>
  );
}
