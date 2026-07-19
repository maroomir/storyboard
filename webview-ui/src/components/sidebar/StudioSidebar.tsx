import {
  Check,
  CircleAlert,
  Expand,
  FileText,
  GitCompare,
  Layers,
  type LucideIcon,
  MessagesSquare,
  RefreshCw,
  Send,
  Sparkles,
  SpellCheck,
  TextSelect,
  Wand2,
  WrapText,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { createRequestId, parseStudioTarget } from '@webview/lib/messaging';
import {
  availableStudioActions,
  interpretStudioInstruction,
  type StudioClarifyReason,
} from '@webview/lib/studioIntent';
import type {
  StoryboardEventMessage,
  StudioActionId,
  StudioInitialData,
  StudioTarget,
} from '@webview/lib/types';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { SectionHeader } from '../ui/SectionHeader';
import { sbInputClass } from '../ui/formClasses';

type ProposalStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

type ChatTurn =
  | { readonly id: string; readonly role: 'user'; readonly text: string }
  | {
      readonly id: string;
      readonly role: 'assistant';
      readonly kind: 'proposal';
      readonly action: StudioActionId;
      readonly instruction?: string;
      readonly status: ProposalStatus;
      readonly requestId?: string;
      readonly errorMessage?: string;
    }
  | {
      readonly id: string;
      readonly role: 'assistant';
      readonly kind: 'clarify';
      readonly reason: StudioClarifyReason;
      readonly suggestions: readonly StudioActionId[];
    };

type StudioResponseMessage = {
  readonly type: 'response';
  readonly id: string;
  readonly ok?: boolean;
  readonly error?: { readonly message?: string };
};

export function StudioSidebar({
  initialData,
}: {
  readonly initialData: StudioInitialData;
}): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), []);
  const [target, setTarget] = useState<StudioTarget>(initialData.target);
  const [turns, setTurns] = useState<readonly ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (
      event: MessageEvent<StoryboardEventMessage | StudioResponseMessage>,
    ): void => {
      const data = event.data;

      if (data.type === 'response' && 'id' in data) {
        settleProposal(setTurns, data);
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
    logEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const appendUserAndIntent = (text: string): void => {
    const intent = interpretStudioInstruction(text, target);
    const userTurn: ChatTurn = { id: createRequestId(), role: 'user', text };
    const assistantTurn: ChatTurn =
      intent.kind === 'action'
        ? {
            id: createRequestId(),
            role: 'assistant',
            kind: 'proposal',
            action: intent.action,
            instruction: intent.instruction,
            status: 'pending',
          }
        : {
            id: createRequestId(),
            role: 'assistant',
            kind: 'clarify',
            reason: intent.reason,
            suggestions: intent.suggestions,
          };

    setTurns((prev) => [...prev, userTurn, assistantTurn]);
  };

  const proposeAction = (action: StudioActionId): void => {
    const userTurn: ChatTurn = { id: createRequestId(), role: 'user', text: actionLabel(action) };
    const assistantTurn: ChatTurn = {
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

    appendUserAndIntent(text);
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

    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: requestId,
      method: 'studio.runAction',
      payload: { action, instruction },
    });
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

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <SectionHeader
        eyebrow="Storyboard"
        title={initialData.title}
        description={targetDescription(target)}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {turns.length === 0 ? (
          <StudioWelcome target={target} onPick={proposeAction} />
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
        <div ref={logEndRef} />
      </div>

      <Composer value={draft} target={target} onChange={setDraft} onSubmit={submitDraft} />
    </main>
  );
}

function settleProposal(
  setTurns: React.Dispatch<React.SetStateAction<readonly ChatTurn[]>>,
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

function StudioWelcome({
  target,
  onPick,
}: {
  readonly target: StudioTarget;
  readonly onPick: (action: StudioActionId) => void;
}): React.ReactElement {
  if (target.kind === 'none') {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-sb-border bg-sb-bg-sidebar/70 p-4">
        <FileText className="h-8 w-8 shrink-0 text-sb-fg-muted" aria-hidden />
        <p className="m-0 text-sm leading-normal text-sb-fg-muted">
          Storyboard 프로젝트를 열면 이야기 완결과 씬 기반 카드 구성을 실행할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-sb-border bg-sb-bg-sidebar/70 p-4">
      <MessagesSquare className="h-8 w-8 shrink-0 text-sb-fg-muted" aria-hidden />
      <p className="m-0 text-sm leading-normal text-sb-fg-muted">
        하고 싶은 작업을 적어 주세요. 제안을 확인하고 승인하면 실행합니다.
      </p>
      <SuggestionChips actions={availableStudioActions(target)} onPick={onPick} />
    </div>
  );
}

function TurnView({
  turn,
  onApprove,
  onCancel,
  onPick,
}: {
  readonly turn: ChatTurn;
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
  readonly turn: Extract<ChatTurn, { readonly kind: 'proposal' }>;
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
  readonly status: ProposalStatus;
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
  onChange,
  onSubmit,
}: {
  readonly value: string;
  readonly target: StudioTarget;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}): React.ReactElement {
  const isDisabled = target.kind === 'none';

  return (
    <div className="flex flex-col gap-2">
      <TargetChip target={target} />
      <div className="flex items-end gap-2">
        <textarea
          className={`${sbInputClass} min-h-12 resize-y`}
          rows={2}
          disabled={isDisabled}
          placeholder={
            isDisabled
              ? 'Storyboard 프로젝트를 먼저 열어 주세요.'
              : '예: 완결해줘, 씬에서 카드 구성해줘, 다시 생성해줘'
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
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

function TargetChip({ target }: { readonly target: StudioTarget }): React.ReactElement {
  if (target.kind === 'none') {
    return <Pill icon={FileText}>대상 없음</Pill>;
  }

  return (
    <Pill icon={FileText}>
      {target.kind === 'draft' ? '초안' : target.kind === 'scene' ? '씬' : '프로젝트'} ·{' '}
      {target.label ?? ''}
    </Pill>
  );
}

function targetDescription(target: StudioTarget): string {
  if (target.kind === 'draft') {
    return `초안 · ${target.label ?? ''}`;
  }

  if (target.kind === 'scene') {
    return `씬 · ${target.label ?? ''}`;
  }

  if (target.kind === 'project') {
    return `프로젝트 · ${target.label ?? ''}`;
  }

  return '열린 대상 없음';
}

function actionLabel(action: StudioActionId): string {
  switch (action) {
    case 'regenerate':
      return '재생성';
    case 'generate':
      return '초안 생성';
    case 'applyFormat':
      return '형식 적용';
    case 'grammarCheck':
      return '문법 검사';
    case 'continuityCheck':
      return '연속성 검사';
    case 'expand':
      return '선택 영역 확장';
    case 'augment':
      return '카드 기반 보충';
    case 'augmentSelection':
      return '선택 영역 보충';
    case 'editSelection':
      return '선택 영역 편집';
    case 'completeStory':
      return '이야기 완결';
    case 'buildCardsFromScenes':
      return '씬 기반 카드 구성';
  }
}

function actionIcon(action: StudioActionId): LucideIcon {
  switch (action) {
    case 'regenerate':
      return RefreshCw;
    case 'generate':
      return Sparkles;
    case 'applyFormat':
      return WrapText;
    case 'grammarCheck':
      return SpellCheck;
    case 'continuityCheck':
      return GitCompare;
    case 'expand':
      return Expand;
    case 'augment':
      return Layers;
    case 'augmentSelection':
      return TextSelect;
    case 'editSelection':
      return Wand2;
    case 'completeStory':
      return FileText;
    case 'buildCardsFromScenes':
      return Layers;
  }
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
    action === 'completeStory' ||
    action === 'buildCardsFromScenes'
  );
}
