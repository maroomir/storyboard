import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLineEditor, type LineEditorState } from '@/tui/lineEditor';
import type { ChoiceRequest, TextRequest } from '@/adapters/prompter';

import { Banner } from '@/tui/banner';
import { ChoiceDialog } from '@/tui/choiceDialog';
import { Dashboard } from '@/tui/dashboard';
import { DraftReader } from '@/tui/draftReader';
import { StatusBar } from '@/tui/statusBar';
import { TextDialog } from '@/tui/textDialog';
import {
  TuiThemeContext,
  tuiThemes,
  useTuiTheme,
  type TuiTheme,
  type TuiThemeName,
} from '@/tui/tuiTheme';
import { SuggestionList } from '@/tui/suggestionList';
import type { TuiHeaderInfo, WorkspaceView } from '@/tui/workspaceView';

export type { TuiHeaderInfo };
import {
  createTuiSession,
  suggestForInput,
  type InputSuggestion,
  type LogEntry,
  type LogTone,
  type TuiSession,
  type TuiSessionOptions,
} from '@/tui/session';

export interface StoryboardTuiProps extends TuiSessionOptions {
  readonly header: TuiHeaderInfo;
  readonly maxLogLines?: number;
  readonly loadWorkspaceView?: () => Promise<WorkspaceView>;
  readonly themeName?: TuiThemeName;
}

const toneRole: Record<LogTone, keyof TuiTheme | undefined> = {
  input: 'accent',
  progress: 'muted',
  result: undefined,
  error: 'danger',
  hint: 'warning',
};

const tonePrefix: Record<LogTone, string> = {
  input: '› ',
  progress: '  · ',
  result: '',
  error: '✗ ',
  hint: '  ',
};

const foldedLineLimit: number = 12;

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
  const theme: TuiTheme = useTuiTheme();
  const lines: string[] = foldLines(entry.text.split('\n'), isExpanded);
  const role: keyof TuiTheme | undefined = toneRole[entry.tone];

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${entry.id}-${index}`} color={role === undefined ? undefined : theme[role]}>
          {index === 0 ? tonePrefix[entry.tone] : ' '.repeat(tonePrefix[entry.tone].length)}
          {line}
        </Text>
      ))}
    </Box>
  );
}

type PendingQuestion =
  | {
      readonly kind: 'choice';
      readonly request: ChoiceRequest<unknown>;
      readonly resolve: (value: unknown) => void;
    }
  | {
      readonly kind: 'text';
      readonly request: TextRequest;
      readonly resolve: (value: string | undefined) => void;
    };

export function StoryboardTui(props: StoryboardTuiProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns: number = stdout.columns > 0 ? stdout.columns : 80;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [escapeHint, setEscapeHint] = useState<string | undefined>(undefined);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [themeName, setThemeName] = useState<TuiThemeName>(props.themeName ?? 'default');
  const theme: TuiTheme = tuiThemes[themeName];
  const [reader, setReader] = useState<
    { readonly title: string; readonly body: string } | undefined
  >(undefined);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | undefined>(undefined);
  const [view, setView] = useState<WorkspaceView>({ header: props.header });
  const nextId: React.MutableRefObject<number> = useRef(1);
  const { loadWorkspaceView } = props;

  const refreshView: () => void = useCallback((): void => {
    void loadWorkspaceView?.().then(setView);
  }, [loadWorkspaceView]);

  useEffect(refreshView, [refreshView]);

  const append: (tone: LogTone, text: string) => void = useCallback(
    (tone: LogTone, text: string): void => {
      setEntries((previous) => [...previous, { id: nextId.current++, tone, text }]);
    },
    [],
  );

  const session: TuiSession = useMemo(
    () =>
      createTuiSession(
        { version: props.version, cwd: props.cwd },
        {
          append,
          ask: <T,>(request: ChoiceRequest<T>) =>
            new Promise<T | undefined>((resolve) =>
              setPendingQuestion({
                kind: 'choice',
                request,
                resolve: (value) => resolve(value as T | undefined),
              }),
            ),
          askText: (request: TextRequest) =>
            new Promise<string | undefined>((resolve) =>
              setPendingQuestion({ kind: 'text', request, resolve }),
            ),
          setTheme: (name: TuiThemeName) => setThemeName(name),
          openReader: (title: string, body: string) => setReader({ title, body }),
          setEscapeHint,
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
  const suggestions: InputSuggestion[] = useMemo(
    () => suggestForInput(inputValue, props.cwd),
    [inputValue, props.cwd],
  );

  const editor: LineEditorState = useLineEditor({
    isActive: !isBusy && reader === undefined,
    suggestions: suggestions.map((suggestion) => suggestion.line),
    onSubmit: (line) => {
      setIsBusy(true);
      void session.run(line).finally(() => {
        setIsBusy(false);
        setEscapeHint(undefined);
        refreshView();
      });
    },
    onExit: () => exit(),
    onToggleOutput: () => setIsOutputExpanded((expanded) => !expanded),
  });

  useEffect(() => {
    setInputValue(editor.value);
  }, [editor.value]);

  useInput(
    (input, key) => {
      if (!key.escape && !(key.ctrl && input === 'c')) {
        return;
      }
      append('hint', session.interrupt());
    },
    { isActive: isBusy && pendingQuestion === undefined },
  );

  const answerChoice = (index: number | undefined): void => {
    if (pendingQuestion?.kind !== 'choice') {
      return;
    }
    setPendingQuestion(undefined);
    pendingQuestion.resolve(
      index === undefined ? undefined : pendingQuestion.request.options[index]?.value,
    );
  };

  const answerText = (answer: string | undefined): void => {
    if (pendingQuestion?.kind !== 'text') {
      return;
    }
    setPendingQuestion(undefined);
    pendingQuestion.resolve(answer);
  };

  const visibleEntries: LogEntry[] = entries.slice(-(props.maxLogLines ?? 200));

  return (
    <TuiThemeContext.Provider value={theme}>
      <Box flexDirection="column">
        <Banner version={props.version} columns={columns} />

        {view.status === undefined ? null : <Dashboard status={view.status} />}

        {reader === undefined ? (
          <Box flexDirection="column" paddingX={1} paddingY={0}>
            {visibleEntries.map((entry) => (
              <LogLine key={entry.id} entry={entry} isExpanded={isOutputExpanded} />
            ))}
          </Box>
        ) : (
          <DraftReader
            title={reader.title}
            body={reader.body}
            columns={columns}
            rows={stdout.rows > 0 ? stdout.rows : 24}
            onClose={() => setReader(undefined)}
          />
        )}

        {editor.isSuggestionOpen && !isBusy ? (
          <SuggestionList
            suggestions={suggestions}
            selectedIndex={editor.selectedSuggestion}
            columns={columns}
          />
        ) : null}

        {pendingQuestion?.kind === 'choice' ? (
          <ChoiceDialog request={pendingQuestion.request} onAnswer={answerChoice} />
        ) : null}
        {pendingQuestion?.kind === 'text' ? (
          <TextDialog request={pendingQuestion.request} onAnswer={answerText} />
        ) : null}

        {editor.search === undefined ? (
          <Box paddingX={1}>
            <Text color={isBusy ? theme.muted : theme.accent}>{isBusy ? '… ' : '❯ '}</Text>
            <Text>
              {editor.value.slice(0, editor.cursor)}
              <Text inverse>{editor.value[editor.cursor] ?? ' '}</Text>
              {editor.value.slice(editor.cursor + 1)}
            </Text>
          </Box>
        ) : (
          <Box paddingX={1}>
            <Text color={theme.accent}>기록 검색 </Text>
            <Text>
              {editor.search.query}
              <Text inverse> </Text>
            </Text>
            <Text color={theme.muted}>
              {'  '}
              {editor.search.match ?? '일치 없음'} · Enter 넣기 · Ctrl+R 이전 · Esc 취소
            </Text>
          </Box>
        )}

        <StatusBar
          view={view}
          isBusy={isBusy}
          columns={columns}
          {...(escapeHint === undefined || pendingQuestion !== undefined ? {} : { escapeHint })}
        />
      </Box>
    </TuiThemeContext.Provider>
  );
}
