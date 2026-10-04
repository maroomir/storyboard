import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLineEditor } from './lineEditor';
import type { ChoiceRequest } from '@/adapters/prompter';

import { Banner } from './banner';
import { ChoiceDialog } from './choiceDialog';
import { Dashboard } from './dashboard';
import { StatusBar } from './statusBar';
import { SuggestionList } from './suggestionList';
import type { TuiHeaderInfo, WorkspaceView } from './workspaceView';

export type { TuiHeaderInfo };
import {
  createTuiSession,
  suggestForInput,
  type LogEntry,
  type LogTone,
  type TuiSession,
  type TuiSessionOptions,
} from './session';

export interface StoryboardTuiProps extends TuiSessionOptions {
  readonly header: TuiHeaderInfo;
  readonly maxLogLines?: number;
  // Reads the workspace around the prompt again; called on start and after every command.
  readonly loadWorkspaceView?: () => Promise<WorkspaceView>;
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
  error: '✗ ',
  hint: '  ',
};

// A result longer than this is folded to its head so one long listing does not push the dashboard
// and the earlier commands off the screen.
const foldedLineLimit = 12;

export function foldLines(lines: readonly string[], isExpanded: boolean): string[] {
  if (isExpanded || lines.length <= foldedLineLimit + 2) {
    return [...lines];
  }

  return [
    ...lines.slice(0, foldedLineLimit),
    `… +${lines.length - foldedLineLimit}줄 · Ctrl+O 로 펼치기`,
  ];
}

function LogLine({
  entry,
  isExpanded,
}: {
  readonly entry: LogEntry;
  readonly isExpanded: boolean;
}): React.ReactElement {
  const lines = foldLines(entry.text.split('\n'), isExpanded);

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

interface PendingChoice {
  readonly request: ChoiceRequest<unknown>;
  readonly resolve: (value: unknown) => void;
}

export function StoryboardTui(props: StoryboardTuiProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout.columns > 0 ? stdout.columns : 80;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | undefined>(undefined);
  const [view, setView] = useState<WorkspaceView>({ header: props.header });
  const nextId = useRef(1);
  const { loadWorkspaceView } = props;

  const refreshView = useCallback((): void => {
    void loadWorkspaceView?.().then(setView);
  }, [loadWorkspaceView]);

  useEffect(refreshView, [refreshView]);

  const append = useCallback((tone: LogTone, text: string): void => {
    setEntries((previous) => [...previous, { id: nextId.current++, tone, text }]);
  }, []);

  const session: TuiSession = useMemo(
    () =>
      createTuiSession(
        { version: props.version, cwd: props.cwd },
        {
          append,
          ask: <T,>(request: ChoiceRequest<T>) =>
            new Promise<T | undefined>((resolve) =>
              setPendingChoice({
                request,
                resolve: (value) => resolve(value as T | undefined),
              }),
            ),
          clear: () => setEntries([]),
          exit: () => exit(),
        },
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
      void session.run(line).finally(() => {
        setIsBusy(false);
        refreshView();
      });
    },
    onExit: () => exit(),
    onToggleOutput: () => setIsOutputExpanded((expanded) => !expanded),
  });

  useEffect(() => {
    setInputValue(editor.value);
  }, [editor.value]);

  // The prompt is idle while a command runs; Esc is the one key that still means something then.
  useInput(
    (_input, key) => {
      if (!key.escape) {
        return;
      }
      append(
        'hint',
        session.requestPause()
          ? '지금 씬을 마치고 멈춥니다.'
          : '이 명령은 중간에 멈출 수 없습니다. 끝날 때까지 기다려 주세요.',
      );
    },
    { isActive: isBusy && pendingChoice === undefined },
  );

  const answerChoice = (index: number | undefined): void => {
    if (pendingChoice === undefined) {
      return;
    }
    setPendingChoice(undefined);
    pendingChoice.resolve(
      index === undefined ? undefined : pendingChoice.request.options[index]?.value,
    );
  };

  const visibleEntries = entries.slice(-(props.maxLogLines ?? 200));

  return (
    <Box flexDirection="column">
      <Banner version={props.version} columns={columns} />

      {view.status === undefined ? null : <Dashboard status={view.status} />}

      <Box flexDirection="column" paddingX={1} paddingY={0}>
        {visibleEntries.map((entry) => (
          <LogLine key={entry.id} entry={entry} isExpanded={isOutputExpanded} />
        ))}
      </Box>

      {editor.isSuggestionOpen && !isBusy ? (
        <SuggestionList
          suggestions={suggestions}
          selectedIndex={editor.selectedSuggestion}
          columns={columns}
        />
      ) : null}

      {pendingChoice === undefined ? null : (
        <ChoiceDialog request={pendingChoice.request} onAnswer={answerChoice} />
      )}

      {editor.search === undefined ? (
        <Box paddingX={1}>
          <Text color={isBusy ? 'gray' : 'cyan'}>{isBusy ? '… ' : '❯ '}</Text>
          <Text>
            {editor.value.slice(0, editor.cursor)}
            <Text inverse>{editor.value[editor.cursor] ?? ' '}</Text>
            {editor.value.slice(editor.cursor + 1)}
          </Text>
        </Box>
      ) : (
        <Box paddingX={1}>
          <Text color="cyan">기록 검색 </Text>
          <Text>
            {editor.search.query}
            <Text inverse> </Text>
          </Text>
          <Text color="gray">
            {'  '}
            {editor.search.match ?? '일치 없음'} · Enter 넣기 · Ctrl+R 이전 · Esc 취소
          </Text>
        </Box>
      )}

      <StatusBar view={view} isBusy={isBusy} />
    </Box>
  );
}
