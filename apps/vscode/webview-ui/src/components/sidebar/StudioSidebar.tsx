import {
  FilePen,
  FileText,
  History,
  Loader2,
  MapPin,
  Send,
  SquarePen,
  User,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  createRequestId,
  parseChatSendPayload,
  parseProgressPayload,
  parseProposalApplyPayload,
  parsePendingFollowUpsPayload,
  parsePreviewFailure,
  parseSessionListPayload,
  parseSessionLoadPayload,
  parseStagePayload,
  parseStudioTarget,
} from '@webview/lib/messaging';
import { editTargetFile, stageFacts, stageTitle } from '@webview/lib/studioStage';
import type {
  StoryboardEventMessage,
  StudioChatStage,
  StudioChatTurn,
  StudioFollowUpTarget,
  StudioInitialData,
  StudioPendingFollowUp,
  StudioProposalTurn,
  StudioSessionSummary,
  StudioStage,
  StudioTarget,
} from '@webview/lib/types';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { SectionHeader } from '../ui/SectionHeader';
import { sbInputClass } from '../ui/formClasses';
import {
  findTool,
  isToolTarget,
  slashToken,
  toolCandidates,
  type StudioComposerTool,
  type StudioToolEntry,
} from '@webview/lib/studioTools';
import { StudioSessionList } from './StudioSessionList';
import { StudioToolMenu } from './StudioToolMenu';
import { StudioTurnView, type StudioProposalActions } from './StudioTurnView';

type StudioResponseMessage = {
  readonly type: 'response';
  readonly id: string;
  readonly ok?: boolean;
  readonly error?: { readonly message?: string };
  readonly payload?: unknown;
};

const stageLabelClass =
  'm-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sb-fg-muted';

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
  const [turns, setTurns] = useState<readonly StudioChatTurn[]>(
    () => initialData.session?.turns ?? [],
  );
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [sessions, setSessions] = useState<readonly StudioSessionSummary[]>([]);
  const [stage, setStage] = useState<StudioStage | undefined>(undefined);
  const [stageToken, setStageToken] = useState(0);
  const [chatStage, setChatStage] = useState<StudioChatStage>('idle');
  const [pendingFollowUps, setPendingFollowUps] = useState<readonly StudioPendingFollowUp[]>([]);
  const [draft, setDraft] = useState('');
  const [pinnedTool, setPinnedTool] = useState<StudioComposerTool | undefined>(undefined);
  const [menuIndex, setMenuIndex] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const listRequestIdRef = useRef<string | undefined>(undefined);
  const loadRequestIdRef = useRef<string | undefined>(undefined);
  const stageRequestIdRef = useRef<string | undefined>(undefined);
  const latestRequestIdRef = useRef<string | undefined>(undefined);
  const sendRequestIdRef = useRef<string | undefined>(undefined);
  const updateCardRequestIdRef = useRef<string | undefined>(undefined);
  const followUpRequestIdRef = useRef<string | undefined>(undefined);
  const applyRequestsRef = useRef<Map<string, string>>(new Map());
  const previewRequestIdRef = useRef<string | undefined>(undefined);
  const loadedEntityRef = useRef<StudioTarget['entity']>(initialData.target.entity);
  const startsFreshRef = useRef(false);

  const post = (method: string, payload: unknown, id = createRequestId()): string => {
    vscodeApi?.postMessage({ protocolVersion: '1.0.0', type: 'request', id, method, payload });
    return id;
  };

  useEffect(() => {
    const handleResponse = (data: StudioResponseMessage): void => {
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
          setTurns(snapshot.turns);
          setView('chat');
        }
        return;
      }

      if (data.id === latestRequestIdRef.current) {
        latestRequestIdRef.current = undefined;
        const snapshot = parseSessionLoadPayload(data.payload);
        if (snapshot) {
          setSessionId(snapshot.id);
          setCreatedAt(snapshot.createdAt);
          setTurns(snapshot.turns);
        }
        return;
      }

      if (data.id === stageRequestIdRef.current) {
        stageRequestIdRef.current = undefined;
        setStage(parseStagePayload(data.payload));
        return;
      }

      if (data.id === followUpRequestIdRef.current) {
        followUpRequestIdRef.current = undefined;
        setPendingFollowUps(parsePendingFollowUpsPayload(data.payload));
        return;
      }

      if (data.id === sendRequestIdRef.current) {
        sendRequestIdRef.current = undefined;
        setChatStage('idle');
        setTurns((prev) => [...prev, ...parseChatSendPayload(data.payload)]);
        return;
      }

      if (data.id === updateCardRequestIdRef.current) {
        updateCardRequestIdRef.current = undefined;
        setChatStage('idle');
        const result = parseCardUpdatePayload(data.payload);
        if (result.ok) {
          // NOTE: the host opened the new card; the target switch starts its conversation and the
          // staged instruction survives it, exactly like a follow-up handoff.
          startsFreshRef.current = true;
          setDraft(result.instruction ?? '');
        }
        return;
      }

      if (data.id === previewRequestIdRef.current) {
        previewRequestIdRef.current = undefined;
        const failure = parsePreviewFailure(data.payload);
        if (failure) {
          setTurns((prev) => [
            ...prev,
            { id: createRequestId(), role: 'assistant', kind: 'say', message: failure },
          ]);
        }
        return;
      }

      const settledTurnId = applyRequestsRef.current.get(data.id);

      if (settledTurnId !== undefined) {
        applyRequestsRef.current.delete(data.id);
        settleProposal(setTurns, settledTurnId, parseProposalApplyPayload(data.payload));
        setStageToken((token) => token + 1);
      }
    };

    const handleMessage = (
      event: MessageEvent<StoryboardEventMessage | StudioResponseMessage>,
    ): void => {
      const data = event.data;

      if (data.type === 'response' && 'id' in data) {
        handleResponse(data);
        return;
      }

      if (data.type === 'event' && data.method === 'studio.targetChanged') {
        setTarget(parseStudioTarget(data.payload));
        return;
      }

      if (data.type === 'event' && data.method === 'studio.chat.progress') {
        setChatStage(parseProgressPayload(data.payload));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!target.entity) {
      setStage(undefined);
      return;
    }

    stageRequestIdRef.current = post('studio.stage', {});
    followUpRequestIdRef.current = post('studio.followUp.list', { entity: target.entity });
  }, [target.entity?.kind, target.entity?.key, stageToken]);

  // NOTE: a conversation belongs to one entity, so switching the open file swaps the whole chat —
  // otherwise the previous entity's turns would be replayed as context and then saved under the new
  // entity's key. The composer draft survives so a follow-up handoff can stage its instruction.
  useEffect(() => {
    if (!isEntityChanged(loadedEntityRef.current, target.entity)) {
      return;
    }

    loadedEntityRef.current = target.entity;
    sendRequestIdRef.current = undefined;
    latestRequestIdRef.current = undefined;
    setChatStage('idle');
    setTurns([]);
    setPinnedTool(undefined);
    setSessionId(createRequestId());
    setCreatedAt(new Date().toISOString());
    setView('chat');

    // NOTE: a follow-up handoff is deliberately a new conversation, so it opts out of restoring
    // whatever was last discussed about that entity.
    if (target.entity && !startsFreshRef.current) {
      latestRequestIdRef.current = post('studio.session.latest', { entity: target.entity });
    }

    startsFreshRef.current = false;
  }, [target.entity?.kind, target.entity?.key]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, chatStage]);

  useEffect(() => {
    if (turns.length === 0 || !target.entity) {
      return;
    }

    post('studio.session.save', {
      id: sessionId,
      entity: target.entity,
      createdAt,
      hasAppliedChanges: turns.some(
        (turn) =>
          turn.role === 'assistant' && turn.kind === 'proposal' && turn.status === 'applied',
      ),
      turns,
    });
  }, [turns]);

  const startNewSession = (): void => {
    // NOTE: an in-flight reply belongs to the conversation being left behind, so its request is
    // dropped here or the composer would stay locked on the new one.
    sendRequestIdRef.current = undefined;
    setChatStage('idle');
    setSessionId(createRequestId());
    setCreatedAt(new Date().toISOString());
    setTurns([]);
    setView('chat');
  };

  const openHistory = (): void => {
    if (!target.entity) {
      return;
    }

    listRequestIdRef.current = post('studio.session.list', { entity: target.entity });
    setView('history');
  };

  const openSession = (id: string): void => {
    if (target.entity) {
      loadRequestIdRef.current = post('studio.session.load', { entity: target.entity, id });
    }
  };

  const sendInstruction = (text: string, tool = pinnedTool): void => {
    const instruction = text.trim();

    if (instruction.length === 0 || chatStage !== 'idle') {
      return;
    }

    if (tool === 'updateCard') {
      setChatStage('thinking');
      setPinnedTool(undefined);
      updateCardRequestIdRef.current = post('studio.card.update', { description: instruction });
      return;
    }

    if (!target.entity) {
      return;
    }

    const history = [...turns];
    setTurns([...history, { id: createRequestId(), role: 'user', text: instruction }]);
    setChatStage('thinking');
    setPinnedTool(undefined);
    sendRequestIdRef.current = post('studio.chat.send', {
      entity: target.entity,
      instruction,
      history,
      ...(tool === undefined ? {} : { tool }),
    });
  };

  const pickTool = (entry: StudioToolEntry): void => {
    setPinnedTool(entry.tool);
    setDraft('');
    setMenuIndex(0);
  };

  // NOTE: the menu opens only while the whole composer is a bare "/token", so a slash inside a
  // sentence is just text.
  const menu = useMemo(() => {
    if (pinnedTool !== undefined || !isToolTarget(target)) {
      return [];
    }

    const token = slashToken(draft);
    return token === undefined ? [] : toolCandidates(token, target);
  }, [draft, pinnedTool, target.kind]);

  const openFollowUp = (followUp: StudioFollowUpTarget): void => {
    startsFreshRef.current = true;
    post('studio.followUp.open', {
      entity: { kind: followUp.kind, key: followUp.key },
      targetFile: followUp.targetFile,
    });
    // NOTE: the editor switch retargets the panel on its own; the instruction is only staged so the
    // author reads it before any request goes out.
    startNewSession();
    setDraft(followUp.instruction);
  };

  const dismissFollowUp = (id: string): void => {
    setPendingFollowUps((prev) => prev.filter((followUp) => followUp.id !== id));
    post('studio.followUp.dismiss', { id });
  };

  const cancelChat = (): void => {
    sendRequestIdRef.current = undefined;
    setChatStage('idle');
    post('studio.chat.cancel', {});
  };

  const proposalActions: StudioProposalActions = {
    onPreview: (turn) => {
      if (target.entity) {
        previewRequestIdRef.current = post('studio.proposal.preview', {
          entity: target.entity,
          turn,
        });
      }
    },
    onApply: (turn: StudioProposalTurn) => {
      if (!target.entity) {
        return;
      }

      const requestId = createRequestId();
      applyRequestsRef.current.set(requestId, turn.id);
      post('studio.proposal.apply', { entity: target.entity, turn }, requestId);
    },
    onReject: (turn) => {
      setTurns((prev) =>
        prev.map((candidate) =>
          candidate.id === turn.id ? { ...turn, status: 'rejected' as const } : candidate,
        ),
      );
    },
  };

  const isHistoryView = view === 'history';
  const canChat = target.entity !== undefined && target.entity.kind !== 'project';

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
        ) : !canChat ? (
          <StudioWelcome target={target} />
        ) : (
          <>
            <StageCard target={target} stage={stage} />
            <PendingFollowUpList
              followUps={pendingFollowUps}
              onPick={setDraft}
              onDismiss={dismissFollowUp}
            />
            {turns.length === 0 ? <StudioIntro /> : null}
            <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Studio 대화">
              {turns.map((turn) => (
                <li key={turn.id}>
                  <StudioTurnView
                    turn={turn}
                    onAnswer={sendInstruction}
                    onOpenFollowUp={openFollowUp}
                    proposalActions={proposalActions}
                  />
                </li>
              ))}
            </ol>
            {chatStage === 'idle' ? null : (
              <ProgressIndicator stage={chatStage} onCancel={cancelChat} />
            )}
          </>
        )}
        <div ref={logEndRef} />
      </div>

      {isHistoryView ? null : (
        <Composer
          value={draft}
          isDisabled={chatStage !== 'idle'}
          placeholder={composerPlaceholder(target, chatStage, pinnedTool)}
          pinnedTool={pinnedTool}
          menu={menu}
          menuIndex={menuIndex}
          hasSelection={target.hasSelection}
          onChange={(value) => {
            setDraft(value);
            setMenuIndex(0);
          }}
          onMoveMenu={(delta) =>
            setMenuIndex((index) => (index + delta + menu.length) % menu.length)
          }
          onPickTool={pickTool}
          onUnpinTool={() => setPinnedTool(undefined)}
          onSubmit={() => {
            sendInstruction(draft.trim().length > 0 ? draft : pinnedInstruction(pinnedTool));
            setDraft('');
          }}
        />
      )}
    </main>
  );
}

function isEntityChanged(left: StudioTarget['entity'], right: StudioTarget['entity']): boolean {
  return left?.kind !== right?.kind || left?.key !== right?.key;
}

function settleProposal(
  setTurns: React.Dispatch<React.SetStateAction<readonly StudioChatTurn[]>>,
  turnId: string,
  result: { readonly status: 'applied' | 'failed'; readonly message: string },
): void {
  setTurns((prev) => {
    const settled = prev.map((turn) =>
      turn.id === turnId && turn.role === 'assistant' && turn.kind === 'proposal'
        ? {
            ...turn,
            status: result.status,
            ...(result.status === 'failed' ? { errorMessage: result.message } : {}),
          }
        : turn,
    );

    return result.status === 'applied'
      ? [
          ...settled,
          {
            id: createRequestId(),
            role: 'assistant' as const,
            kind: 'result' as const,
            message: result.message,
          },
        ]
      : settled;
  });
}

function PendingFollowUpList({
  followUps,
  onPick,
  onDismiss,
}: {
  readonly followUps: readonly StudioPendingFollowUp[];
  readonly onPick: (instruction: string) => void;
  readonly onDismiss: (id: string) => void;
}): React.ReactElement | null {
  if (followUps.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="넘어온 작업"
      className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
    >
      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-500">
        다른 곳에서 넘어온 작업 {followUps.length}건
      </p>
      {followUps.map((followUp) => (
        <div key={followUp.id} className="flex items-start gap-1.5">
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded border border-transparent px-1 py-0.5 text-left outline-none hover:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
            onClick={() => onPick(followUp.instruction)}
          >
            <span className="text-xs text-sb-fg">{followUp.reason}</span>
            <span className="text-[10px] text-sb-fg-muted">
              {followUp.origin.kind}/{followUp.origin.key} 에서
            </span>
          </button>
          <button
            type="button"
            aria-label="넘어온 작업 닫기"
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-sb-fg-muted outline-none hover:text-sb-fg focus-visible:ring-1 focus-visible:ring-sb-border-focus"
            onClick={() => onDismiss(followUp.id)}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ))}
    </section>
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

function StudioWelcome({ target }: { readonly target: StudioTarget }): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-sb-border bg-sb-bg-sidebar/70 p-4">
      <FileText className="h-8 w-8 shrink-0 text-sb-fg-muted" aria-hidden />
      <p className="m-0 text-sm leading-normal text-sb-fg-muted">
        {target.kind === 'none'
          ? 'Storyboard 프로젝트를 열면 카드와 씬을 대화로 다듬을 수 있습니다.'
          : '인물·배경 카드나 씬·초안 파일을 열면 그 대상과 대화를 시작할 수 있습니다.'}
      </p>
    </div>
  );
}

function StudioIntro(): React.ReactElement {
  return (
    <p className="m-0 text-xs leading-relaxed text-sb-fg-muted">
      고치고 싶은 내용을 말로 적어 주세요. 모호하면 되묻고, 정해지면 수정안을 제안합니다. 적용은
      승인해야 이뤄집니다.
    </p>
  );
}

function StageCard({
  target,
  stage,
}: {
  readonly target: StudioTarget;
  readonly stage?: StudioStage;
}): React.ReactElement {
  const facts = stageFacts(stage);
  const editTarget = editTargetFile(target);

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
      {editTarget ? (
        <p className="m-0 flex items-center gap-1 text-xs text-sb-fg-muted">
          <FilePen className="h-3 w-3 shrink-0" aria-hidden />
          지금 고칠 대상: <code className="text-sb-fg">{editTarget}</code>
        </p>
      ) : null}
      <StagePills stage={stage} />
    </section>
  );
}

function StagePills({ stage }: { readonly stage?: StudioStage }): React.ReactElement | null {
  if (!stage) {
    return null;
  }

  const pills =
    stage.kind === 'card'
      ? stage.relations.map((relation) => ({
          key: `relation-${relation.target}`,
          tone: 'character' as const,
          icon: User,
          text: `${relation.target} · ${relation.type}`,
        }))
      : stage.cards.map((card) => ({
          key: `${card.kind}-${card.name}`,
          tone: card.kind === 'character' ? ('character' as const) : ('background' as const),
          icon: card.kind === 'character' ? User : MapPin,
          text: card.name,
        }));

  if (pills.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {pills.map((pill) => (
        <Pill key={pill.key} tone={pill.tone} icon={pill.icon}>
          {pill.text}
        </Pill>
      ))}
    </div>
  );
}

function ProgressIndicator({
  stage,
  onCancel,
}: {
  readonly stage: StudioChatStage;
  readonly onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2" role="status">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sb-fg-muted" aria-hidden />
      <span className="text-sm text-sb-fg-muted">{chatStageLabel(stage)}</span>
      <button
        type="button"
        aria-label="중단"
        className="inline-flex cursor-pointer items-center gap-1 rounded border border-sb-border px-1.5 py-0.5 text-xs text-sb-fg-muted outline-none hover:border-sb-border-focus hover:text-sb-fg focus-visible:ring-1 focus-visible:ring-sb-border-focus"
        onClick={onCancel}
      >
        <X className="h-3 w-3" aria-hidden />
        중단
      </button>
    </div>
  );
}

function Composer({
  value,
  isDisabled,
  placeholder,
  pinnedTool,
  menu,
  menuIndex,
  hasSelection,
  onChange,
  onMoveMenu,
  onPickTool,
  onUnpinTool,
  onSubmit,
}: {
  readonly value: string;
  readonly isDisabled: boolean;
  readonly placeholder: string;
  readonly pinnedTool: StudioComposerTool | undefined;
  readonly menu: readonly StudioToolEntry[];
  readonly menuIndex: number;
  readonly hasSelection: boolean;
  readonly onChange: (value: string) => void;
  readonly onMoveMenu: (delta: number) => void;
  readonly onPickTool: (entry: StudioToolEntry) => void;
  readonly onUnpinTool: () => void;
  readonly onSubmit: () => void;
}): React.ReactElement {
  const isMenuOpen = menu.length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isMenuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      onMoveMenu(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (isMenuOpen && (event.key === 'Enter' || event.key === 'Tab')) {
      const picked = menu[menuIndex];
      if (picked) {
        event.preventDefault();
        onPickTool(picked);
      }
      return;
    }

    if (event.key === 'Escape' && isMenuOpen) {
      event.preventDefault();
      onChange('');
      return;
    }

    // NOTE: backspace on an empty composer takes the pin off, the way a chip-style input behaves.
    if (event.key === 'Backspace' && value.length === 0 && pinnedTool !== undefined) {
      event.preventDefault();
      onUnpinTool();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim().length > 0 || pinnedTool !== undefined) {
        onSubmit();
      }
    }
  };

  const pinned = pinnedTool === undefined ? undefined : findTool(pinnedTool);

  return (
    <div className="flex flex-col">
      <StudioToolMenu
        candidates={menu}
        activeIndex={menuIndex}
        hasSelection={hasSelection}
        onPick={onPickTool}
      />
      <div className="flex items-end gap-2">
        <div className={`${sbInputClass} flex min-h-12 flex-1 flex-col gap-1 p-1`}>
          {pinned ? (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded bg-[var(--vscode-badge-background)] px-1.5 py-0.5 text-[11px] text-[var(--vscode-badge-foreground)]">
                /{pinned.command}
                <button
                  type="button"
                  aria-label={`${pinned.label} 지정 해제`}
                  className="opacity-70"
                  onClick={onUnpinTool}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
              {pinned.needsSelection && !hasSelection ? (
                <span className="text-[10px] text-sb-fg-muted">
                  구간을 선택하지 않으면 조수가 알아서 잡습니다
                </span>
              ) : null}
            </div>
          ) : null}
          <textarea
            className="min-h-8 flex-1 resize-y border-0 bg-transparent p-1 text-inherit outline-none"
            rows={2}
            disabled={isDisabled}
            role="textbox"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <Button
          aria-label="보내기"
          disabled={isDisabled || (value.trim().length === 0 && pinnedTool === undefined)}
          onClick={onSubmit}
        >
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function chatStageLabel(stage: StudioChatStage): string {
  switch (stage) {
    case 'thinking':
      return '생각하는 중…';
    case 'looking-up':
      return '관련 자료를 찾는 중…';
    case 'invoking':
      return '도구를 실행하는 중…';
    case 'validating':
      return '정합성을 확인하는 중…';
    case 'idle':
      return '';
  }
}

function parseCardUpdatePayload(payload: unknown): {
  readonly ok: boolean;
  readonly instruction?: string;
} {
  const data = (payload && typeof payload === 'object' ? payload : {}) as {
    ok?: unknown;
    instruction?: unknown;
  };

  return {
    ok: data.ok === true,
    ...(typeof data.instruction === 'string' ? { instruction: data.instruction } : {}),
  };
}

function pinnedInstruction(tool: StudioComposerTool | undefined): string {
  return (tool === undefined ? undefined : findTool(tool)?.defaultInstruction) ?? '';
}

function composerPlaceholder(
  target: StudioTarget,
  stage: StudioChatStage,
  pinnedTool: StudioComposerTool | undefined,
): string {
  if (stage !== 'idle') {
    return '응답을 기다리는 중…';
  }

  if (pinnedTool === 'updateCard') {
    return '카드를 설명해 주세요 (이름을 앞세워서)';
  }

  if (pinnedTool !== undefined) {
    return '어떻게 할지 덧붙여 적으세요 (그냥 보내도 됩니다)';
  }

  if (!target.entity || target.entity.kind === 'project') {
    return '카드나 씬 파일을 열거나, /update 로 카드를 만드세요.';
  }

  if (target.entity.kind !== 'scene') {
    return '예: 화재 트라우마를 과거사에 더해줘';
  }

  return target.kind === 'scene'
    ? '예: 이 씬의 갈등을 더 선명하게 정리해줘'
    : '예: 도입부를 더 긴장감 있게 고쳐줘';
}
