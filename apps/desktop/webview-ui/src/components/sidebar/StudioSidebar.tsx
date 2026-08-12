import {
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  History,
  MapPin,
  MessagesSquare,
  Send,
  Sparkles,
  SquarePen,
  User,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  createRequestId,
  normalizeRestoredTurns,
  parseSessionListPayload,
  parseSessionLoadPayload,
  parseStagePayload,
  parseStudioTarget,
} from '@webview/lib/messaging';
import {
  actionIcon,
  actionLabel,
  actionRationale,
  parseSlashInput,
  slashCandidates,
  slashMenuState,
} from '@webview/lib/studioCommands';
import {
  interpretStudioInstruction,
  recommendedStudioActions,
  type StudioClarifyReason,
  type StudioIntent,
} from '@webview/lib/studioIntent';
import { stageFacts, stageTitle } from '@webview/lib/studioStage';
import type {
  StoryboardEventMessage,
  StudioActionId,
  StudioChatTurn,
  StudioInitialData,
  StudioProposalStatus,
  StudioSessionSummary,
  StudioStage,
  StudioTarget,
} from '@webview/lib/types';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { SectionHeader } from '../ui/SectionHeader';
import { sbInputClass } from '../ui/formClasses';
import { SlashCommandMenu } from './SlashCommandMenu';
import { StudioSessionList } from './StudioSessionList';

type StudioResponseMessage = {
  readonly type: 'response';
  readonly id: string;
  readonly ok?: boolean;
  readonly error?: { readonly message?: string };
  readonly payload?: unknown;
};

export function StudioSidebar({
  initialData,
}: {
  readonly initialData: StudioInitialData;
}): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), []);
  const [target, setTarget] = useState<StudioTarget>(initialData.target);
  const [sessionId, setSessionId] = useState(() => initialData.session?.id ?? createRequestId());
  const [createdAt, setCreatedAt] = useState(
    () => initialData.session?.createdAt ?? new Date().toISOString(),
  );
  const [turns, setTurns] = useState<readonly StudioChatTurn[]>(() =>
    initialData.session ? normalizeRestoredTurns(initialData.session.turns) : [],
  );
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [sessions, setSessions] = useState<readonly StudioSessionSummary[]>([]);
  const [stage, setStage] = useState<StudioStage | undefined>(undefined);
  const [stageToken, setStageToken] = useState(0);
  const [draft, setDraft] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const listRequestIdRef = useRef<string | undefined>(undefined);
  const loadRequestIdRef = useRef<string | undefined>(undefined);
  const stageRequestIdRef = useRef<string | undefined>(undefined);
  const runningRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleMessage = (
      event: MessageEvent<StoryboardEventMessage | StudioResponseMessage>,
    ): void => {
      const data = event.data;

      if (data.type === 'response' && 'id' in data) {
        if (data.id === listRequestIdRef.current) {
          listRequestIdRef.current = undefined;
          setSessions(parseSessionListPayload(data.payload));
          return;
        }

        if (data.id === loadRequestIdRef.current) {
          loadRequestIdRef.current = undefined;
          const snapshot = parseSessionLoadPayload(data.payload);
          if (snapshot) {
            setSessionId(snapshot.id);
            setCreatedAt(snapshot.createdAt);
            setTurns(normalizeRestoredTurns(snapshot.turns));
            setView('chat');
          }
          return;
        }

        if (data.id === stageRequestIdRef.current) {
          stageRequestIdRef.current = undefined;
          setStage(parseStagePayload(data.payload));
          return;
        }

        if (runningRequestIdsRef.current.delete(data.id)) {
          settleProposal(setTurns, data);
          setStageToken((token) => token + 1);
        }

        return;
      }

      if (data.type === 'event' && data.method === 'studio.targetChanged') {
        setTarget(parseStudioTarget(data.payload));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (target.kind === 'none' || !target.sceneUri) {
      setStage(undefined);
      return;
    }

    const requestId = createRequestId();
    stageRequestIdRef.current = requestId;
    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: requestId,
      method: 'studio.stage',
      payload: {},
    });
  }, [target.kind, target.sceneUri, stageToken]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  useEffect(() => {
    if (turns.length === 0) {
      return;
    }

    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: createRequestId(),
      method: 'studio.session.save',
      payload: { id: sessionId, createdAt, turns },
    });
  }, [turns]);

  const startNewSession = (): void => {
    setSessionId(createRequestId());
    setCreatedAt(new Date().toISOString());
    setTurns([]);
    setView('chat');
  };

  const openHistory = (): void => {
    const requestId = createRequestId();
    listRequestIdRef.current = requestId;
    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: requestId,
      method: 'studio.session.list',
      payload: {},
    });
    setView('history');
  };

  const openSession = (id: string): void => {
    const requestId = createRequestId();
    loadRequestIdRef.current = requestId;
    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: requestId,
      method: 'studio.session.load',
      payload: { id },
    });
  };

  const postRunAction = (requestId: string, action: StudioActionId, instruction?: string): void => {
    runningRequestIdsRef.current.add(requestId);
    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: requestId,
      method: 'studio.runAction',
      payload: { action, instruction },
    });
  };

  const appendTurnsForIntent = (text: string, intent: StudioIntent, autoRun: boolean): void => {
    const userTurn: StudioChatTurn = { id: createRequestId(), role: 'user', text };

    if (intent.kind === 'clarify') {
      const clarifyTurn: StudioChatTurn = {
        id: createRequestId(),
        role: 'assistant',
        kind: 'clarify',
        reason: intent.reason,
        suggestions: intent.suggestions,
      };
      setTurns((prev) => [...prev, userTurn, clarifyTurn]);
      return;
    }

    if (!autoRun) {
      const proposalTurn: StudioChatTurn = {
        id: createRequestId(),
        role: 'assistant',
        kind: 'proposal',
        action: intent.action,
        instruction: intent.instruction,
        status: 'pending',
      };
      setTurns((prev) => [...prev, userTurn, proposalTurn]);
      return;
    }

    const requestId = createRequestId();
    const proposalTurn: StudioChatTurn = {
      id: createRequestId(),
      role: 'assistant',
      kind: 'proposal',
      action: intent.action,
      instruction: intent.instruction,
      status: 'running',
      requestId,
    };
    setTurns((prev) => [...prev, userTurn, proposalTurn]);
    postRunAction(requestId, intent.action, intent.instruction);
  };

  const proposeAction = (action: StudioActionId): void => {
    const userTurn: StudioChatTurn = { id: createRequestId(), role: 'user', text: actionLabel(action) };
    const assistantTurn: StudioChatTurn = {
      id: createRequestId(),
      role: 'assistant',
      kind: 'proposal',
      action,
      status: 'pending',
    };
    setTurns((prev) => [...prev, userTurn, assistantTurn]);
  };

  const submitDraft = (): void => {
    const text = draft.trim();
    if (text.length === 0 || target.kind === 'none') {
      return;
    }

    const slashIntent = parseSlashInput(text, target);
    const intent = slashIntent ?? interpretStudioInstruction(text, target);
    appendTurnsForIntent(text, intent, slashIntent?.kind === 'action');
    setDraft('');
  };

  const approveProposal = (turnId: string, action: StudioActionId, instruction?: string): void => {
    const requestId = createRequestId();

    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId && turn.role === 'assistant' && turn.kind === 'proposal'
          ? { ...turn, status: 'running', requestId }
          : turn,
      ),
    );

    postRunAction(requestId, action, instruction);
  };

  const cancelProposal = (turnId: string): void => {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId && turn.role === 'assistant' && turn.kind === 'proposal'
          ? { ...turn, status: 'cancelled' }
          : turn,
      ),
    );
  };

  const isHistoryView = view === 'history';

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <div className="flex items-start justify-between gap-2">
        <SectionHeader eyebrow="Storyboard" title={initialData.title} />
        <div className="flex shrink-0 items-center gap-1">
          <HeaderButton label="새 대화" icon={SquarePen} onClick={startNewSession} />
          <HeaderButton
            label={isHistoryView ? '대화로 돌아가기' : '대화 기록'}
            icon={History}
            isActive={isHistoryView}
            onClick={isHistoryView ? () => setView('chat') : openHistory}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {isHistoryView ? (
          <StudioSessionList sessions={sessions} onOpen={openSession} />
        ) : target.kind === 'none' ? (
          <StudioWelcome />
        ) : (
          <>
            <StageCard target={target} stage={stage} />
            {turns.length === 0 ? (
              <RecommendationList target={target} onPick={proposeAction} />
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Studio 대화">
                {turns.map((turn) => (
                  <li key={turn.id}>
                    <TurnView
                      turn={turn}
                      onApprove={approveProposal}
                      onCancel={cancelProposal}
                      onPick={proposeAction}
                    />
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        <div ref={logEndRef} />
      </div>

      {isHistoryView ? null : (
        <Composer
          value={draft}
          target={target}
          stage={stage}
          onChange={setDraft}
          onSubmit={submitDraft}
        />
      )}
    </main>
  );
}

function HeaderButton({
  label,
  icon: Icon,
  isActive = false,
  onClick,
}: {
  readonly label: string;
  readonly icon: typeof History;
  readonly isActive?: boolean;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border border-sb-border bg-sb-bg-widget text-sb-fg-muted outline-none hover:border-sb-border-focus hover:text-sb-fg focus-visible:ring-1 focus-visible:ring-sb-border-focus ${
        isActive ? 'text-sb-fg' : ''
      }`}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function settleProposal(
  setTurns: React.Dispatch<React.SetStateAction<readonly StudioChatTurn[]>>,
  response: StudioResponseMessage,
): void {
  setTurns((prev) =>
    prev.map((turn) => {
      if (turn.role !== 'assistant' || turn.kind !== 'proposal' || turn.requestId !== response.id) {
        return turn;
      }

      return response.ok === false
        ? { ...turn, status: 'failed', errorMessage: response.error?.message }
        : { ...turn, status: 'done' };
    }),
  );
}

function StudioWelcome(): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-sb-border bg-sb-bg-sidebar/70 p-4">
      <FileText className="h-8 w-8 shrink-0 text-sb-fg-muted" aria-hidden />
      <p className="m-0 text-sm leading-normal text-sb-fg-muted">
        Storyboard 프로젝트를 열면 이야기 완결과 씬 기반 카드 구성을 실행할 수 있습니다.
      </p>
    </div>
  );
}

const stageLabelClass =
  'm-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sb-fg-muted';

function StageCard({
  target,
  stage,
}: {
  readonly target: StudioTarget;
  readonly stage?: StudioStage;
}): React.ReactElement {
  const facts = stageFacts(stage);

  return (
    <section
      aria-label="지금 무대"
      className="flex flex-col gap-1.5 rounded-lg border border-sb-border border-l-2 border-l-sb-accent-character bg-sb-bg-widget px-3 py-2.5"
    >
      <p className={stageLabelClass}>지금 무대</p>
      <p className="m-0 text-sm font-semibold text-sb-fg">{stageTitle(target, stage)}</p>
      {facts.length > 0 ? (
        <p className="m-0 text-xs text-sb-fg-muted">{facts.join(' · ')}</p>
      ) : null}
      {stage && stage.cards.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {stage.cards.map((card) => (
            <Pill
              key={`${card.kind}-${card.name}`}
              tone={card.kind === 'character' ? 'character' : 'background'}
              icon={card.kind === 'character' ? User : MapPin}
            >
              {card.name}
            </Pill>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RecommendationList({
  target,
  onPick,
}: {
  readonly target: StudioTarget;
  readonly onPick: (action: StudioActionId) => void;
}): React.ReactElement | null {
  const actions = recommendedStudioActions(target);

  if (actions.length === 0) {
    return null;
  }

  return (
    <section aria-label="다음으로 추천" className="flex flex-col gap-1.5">
      <p className={stageLabelClass}>다음으로 추천</p>
      {actions.map((action) => {
        const ActionIcon = actionIcon(action);
        return (
          <button
            key={action}
            type="button"
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-sb-border bg-sb-bg-widget px-3 py-2 text-left outline-none hover:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
            onClick={() => onPick(action)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-sb-fg">
                <ActionIcon className="h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />
                {actionLabel(action)}
              </span>
              <span className="text-xs text-sb-fg-muted">{actionRationale(action)}</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />
          </button>
        );
      })}
    </section>
  );
}

function TurnView({
  turn,
  onApprove,
  onCancel,
  onPick,
}: {
  readonly turn: StudioChatTurn;
  readonly onApprove: (turnId: string, action: StudioActionId, instruction?: string) => void;
  readonly onCancel: (turnId: string) => void;
  readonly onPick: (action: StudioActionId) => void;
}): React.ReactElement {
  if (turn.role === 'user') {
    return (
      <div className="ml-auto max-w-[92%] rounded-lg rounded-br-sm border border-sb-border bg-sb-bg-list-hover px-3 py-2 text-sm text-sb-fg">
        {turn.text}
      </div>
    );
  }

  if (turn.kind === 'clarify') {
    return (
      <div className="flex max-w-[92%] flex-col gap-2 rounded-lg rounded-bl-sm border border-sb-border bg-sb-bg-widget px-3 py-2">
        <p className="m-0 flex items-center gap-1.5 text-sm text-sb-fg">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />
          {clarifyMessage(turn.reason)}
        </p>
        <SuggestionChips actions={turn.suggestions} onPick={onPick} />
      </div>
    );
  }

  return <ProposalCard turn={turn} onApprove={onApprove} onCancel={onCancel} />;
}

function ProposalCard({
  turn,
  onApprove,
  onCancel,
}: {
  readonly turn: Extract<StudioChatTurn, { readonly kind: 'proposal' }>;
  readonly onApprove: (turnId: string, action: StudioActionId, instruction?: string) => void;
  readonly onCancel: (turnId: string) => void;
}): React.ReactElement {
  const ActionIcon = actionIcon(turn.action);

  return (
    <div className="flex max-w-[92%] flex-col gap-2 rounded-lg rounded-bl-sm border border-sb-border bg-sb-bg-widget px-3 py-2">
      <div className="flex flex-col gap-1">
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-sb-fg">
          <ActionIcon className="h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />
          {actionLabel(turn.action)}
        </p>
        {turn.instruction ? (
          <p className="m-0 text-sm text-sb-fg-muted">“{turn.instruction}”</p>
        ) : null}
        {showsDiff(turn.action) ? (
          <p className="m-0 text-xs text-sb-fg-muted">적용 전 diff로 변경을 확인할 수 있어요.</p>
        ) : null}
      </div>

      {turn.status === 'pending' ? (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => onApprove(turn.id, turn.action, turn.instruction)}>승인</Button>
          <Button variant="secondary" onClick={() => onCancel(turn.id)}>
            취소
          </Button>
        </div>
      ) : (
        <ProposalStatusLine status={turn.status} errorMessage={turn.errorMessage} />
      )}
    </div>
  );
}

function ProposalStatusLine({
  status,
  errorMessage,
}: {
  readonly status: StudioProposalStatus;
  readonly errorMessage?: string;
}): React.ReactElement {
  if (status === 'running') {
    return <p className="m-0 text-sm text-sb-fg-muted">실행 중…</p>;
  }

  if (status === 'done') {
    return (
      <p className="m-0 flex items-center gap-1.5 text-sm text-emerald-500">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        완료
      </p>
    );
  }

  if (status === 'failed') {
    return (
      <p className="m-0 flex items-center gap-1.5 text-sm text-sb-fg-error">
        <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        실패{errorMessage ? ` · ${errorMessage}` : ''}
      </p>
    );
  }

  return <p className="m-0 text-sm text-sb-fg-muted">취소됨</p>;
}

function SuggestionChips({
  actions,
  onPick,
}: {
  readonly actions: readonly StudioActionId[];
  readonly onPick: (action: StudioActionId) => void;
}): React.ReactElement | null {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action) => {
        const ActionIcon = actionIcon(action);
        return (
          <button
            key={action}
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-sb-border bg-sb-bg-widget px-2.5 py-1 text-xs text-sb-fg outline-none hover:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
            onClick={() => onPick(action)}
          >
            <ActionIcon className="h-3 w-3 shrink-0 text-sb-fg-muted" aria-hidden />
            {actionLabel(action)}
          </button>
        );
      })}
    </div>
  );
}

function Composer({
  value,
  target,
  stage,
  onChange,
  onSubmit,
}: {
  readonly value: string;
  readonly target: StudioTarget;
  readonly stage?: StudioStage;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}): React.ReactElement {
  const isDisabled = target.kind === 'none';
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);

  const menu = isDisabled ? undefined : slashMenuState(value);
  const candidates = menu ? slashCandidates(menu.token, target) : [];
  const isMenuOpen = !isDismissed && candidates.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [menu?.token, candidates.length]);

  const changeValue = (next: string): void => {
    setIsDismissed(false);
    onChange(next);
  };

  const selectCandidate = (command: string): void => {
    setIsDismissed(false);
    onChange(`/${command} `);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % candidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectCandidate(candidates[activeIndex].command);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsDismissed(true);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {isDisabled ? null : (
        <p className="m-0 text-xs text-sb-fg-muted">
          지시는 «{stageTitle(target, stage)}»를 대상으로 실행됩니다.
        </p>
      )}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          {isMenuOpen ? (
            <SlashCommandMenu
              items={candidates}
              activeIndex={activeIndex}
              onSelect={selectCandidate}
              onHover={setActiveIndex}
            />
          ) : null}
          <textarea
            className={`${sbInputClass} min-h-12 w-full resize-y`}
            rows={2}
            disabled={isDisabled}
            role="textbox"
            aria-controls={isMenuOpen ? 'studio-slash-menu' : undefined}
            aria-activedescendant={isMenuOpen ? `studio-slash-option-${activeIndex}` : undefined}
            placeholder={
              isDisabled
                ? 'Storyboard 프로젝트를 먼저 열어 주세요.'
                : '예: 완결해줘, 씬에서 카드 구성해줘, 다시 생성해줘 (/ 명령)'
            }
            value={value}
            onChange={(event) => changeValue(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <Button
          aria-label="보내기"
          disabled={isDisabled || value.trim().length === 0}
          onClick={onSubmit}
        >
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function clarifyMessage(reason: StudioClarifyReason): string {
  switch (reason) {
    case 'no-target':
      return '씬(scene/*.txt) 또는 초안(draft/*.md) 파일을 먼저 열어 주세요.';
    case 'needs-selection':
      return '본문에서 영역을 먼저 선택한 뒤 다시 시도해 주세요.';
    case 'needs-draft':
      return '먼저 초안을 생성한 뒤 다시 시도해 주세요.';
    case 'ambiguous':
      return '무엇을 할지 이해하지 못했어요. 아래에서 골라 주세요.';
  }
}

function showsDiff(action: StudioActionId): boolean {
  return (
    action === 'augment' ||
    action === 'augmentSelection' ||
    action === 'editSelection' ||
    action === 'condense' ||
    action === 'completeStory' ||
    action === 'buildCardsFromScenes'
  );
}
