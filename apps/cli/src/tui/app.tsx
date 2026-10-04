import { Box, Text, useApp, useStdout } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLineEditor } from './lineEditor';
import { SuggestionList } from './suggestionList';
import {
  createTuiSession,
  suggestForInput,
  type LogEntry,
  type LogTone,
  type TuiSession,
  type TuiSessionOptions,
} from './session';

export interface TuiHeaderInfo {
  readonly workspaceLabel: string;
  readonly providerLabel: string;
  readonly hint?: string;
}

export interface StoryboardTuiProps extends TuiSessionOptions {
  readonly header: TuiHeaderInfo;
  readonly maxLogLines?: number;
}

const toneColor: Record<LogTone, string | undefined> = {
  input: 'cyan',
  progress: 'gray',
  result: undefined,
  error: 'red',
  hint: 'yellow',
};

const tonePrefix: Record<LogTone, string> = {
  input: '› ',
  progress: '  · ',
  result: '',
  error: '✖ ',
  hint: '  ',
};

function LogLine({ entry }: { readonly entry: LogEntry }): React.ReactElement {
  const lines = entry.text.split('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${entry.id}-${index}`} color={toneColor[entry.tone]}>
          {index === 0 ? tonePrefix[entry.tone] : ' '.repeat(tonePrefix[entry.tone].length)}
          {line}
        </Text>
      ))}
    </Box>
  );
}

export function StoryboardTui(props: StoryboardTuiProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const nextId = useRef(1);

  const append = useCallback((tone: LogTone, text: string): void => {
    setEntries((previous) => [...previous, { id: nextId.current++, tone, text }]);
  }, []);

  const session: TuiSession = useMemo(
    () =>
      createTuiSession(
        { version: props.version, cwd: props.cwd },
        { append, clear: () => setEntries([]), exit: () => exit() },
      ),
    [append, exit, props.cwd, props.version],
  );

  useEffect(() => {
    append(
      'hint',
      '명령을 그대로 치거나(예: draft generate --all), /help 로 목록을 보세요. Tab 으로 제안을 고르고 /quit 로 나갑니다.',
    );
    if (props.header.hint) {
      append('hint', props.header.hint);
    }
  }, [append, props.header.hint]);

  const [inputValue, setInputValue] = useState('');
  const suggestions = useMemo(
    () => suggestForInput(inputValue, props.cwd),
    [inputValue, props.cwd],
  );

  const editor = useLineEditor({
    isActive: !isBusy,
    suggestions: suggestions.map((suggestion) => suggestion.line),
    onSubmit: (line) => {
      setIsBusy(true);
      void session.run(line).finally(() => setIsBusy(false));
    },
    onExit: () => exit(),
  });

  useEffect(() => {
    setInputValue(editor.value);
  }, [editor.value]);

  const visibleEntries = entries.slice(-(props.maxLogLines ?? 200));

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text>
          <Text bold color="cyan">
            Storyboard
          </Text>
          <Text> {props.version}</Text>
          <Text color="gray"> · {props.header.workspaceLabel}</Text>
        </Text>
        <Text color="gray">{props.header.providerLabel}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} paddingY={0}>
        {visibleEntries.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
      </Box>

      {editor.isSuggestionOpen && !isBusy ? (
        <SuggestionList
          suggestions={suggestions}
          selectedIndex={editor.selectedSuggestion}
          columns={stdout.columns > 0 ? stdout.columns : 80}
        />
      ) : null}

      <Box paddingX={1}>
        <Text color={isBusy ? 'gray' : 'cyan'}>{isBusy ? '… ' : '❯ '}</Text>
        <Text>
          {editor.value.slice(0, editor.cursor)}
          <Text inverse>{editor.value[editor.cursor] ?? ' '}</Text>
          {editor.value.slice(editor.cursor + 1)}
        </Text>
      </Box>
    </Box>
  );
}
