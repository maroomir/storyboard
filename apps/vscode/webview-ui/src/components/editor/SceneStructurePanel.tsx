import React, { useCallback, useState } from 'react';

import { createRequestId } from '@webview/lib/messaging';
import type { SceneCard } from '@webview/lib/types';
import { Button } from '../ui/Button';

type VscodeApi = ReturnType<NonNullable<typeof window.acquireVsCodeApi>>;

export interface SceneStructureProposal {
  readonly purpose?: string;
  readonly conflict?: string;
  readonly twist?: string;
  readonly emotionalShift?: string;
  readonly endState?: string;
  readonly foreshadowing?: readonly string[];
  readonly neededCanon?: readonly string[];
}

type RpcResponse<T> = {
  readonly type: 'response';
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: T;
  readonly error?: { readonly message: string };
};

function callRpc<T>(
  vscodeApi: VscodeApi,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = createRequestId();

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent): void => {
      const data = event.data as RpcResponse<T> | undefined;
      if (!data || data.type !== 'response' || data.id !== id) {
        return;
      }

      window.removeEventListener('message', handler);

      if (data.ok && data.payload !== undefined) {
        resolve(data.payload);
        return;
      }

      reject(new Error(data.error?.message ?? '요청을 처리하지 못했습니다.'));
    };

    window.addEventListener('message', handler);
    vscodeApi.postMessage({ protocolVersion: '1.0.0', type: 'request', id, method, payload });
  });
}

const SCALAR_LABELS: readonly {
  key: 'purpose' | 'conflict' | 'twist' | 'emotionalShift' | 'endState';
  label: string;
}[] = [
  { key: 'purpose', label: '목적' },
  { key: 'conflict', label: '갈등' },
  { key: 'twist', label: '반전' },
  { key: 'emotionalShift', label: '감정 변화' },
  { key: 'endState', label: '종료 지점' },
];

const LIST_LABELS: readonly { key: 'foreshadowing' | 'neededCanon'; label: string }[] = [
  { key: 'foreshadowing', label: '회수할 복선' },
  { key: 'neededCanon', label: '필요 설정' },
];

// NOTE: 제안은 비어 있는 필드에만 반영한다 — 사용자가 적어 둔 값이 항상 이긴다(grounding과 같은 규칙).
export function applyStructureProposal(
  card: SceneCard,
  proposal: SceneStructureProposal,
): SceneCard {
  let next: SceneCard = card;

  for (const { key } of SCALAR_LABELS) {
    const proposed = proposal[key]?.trim();
    if ((next[key]?.trim() ?? '') === '' && proposed !== undefined && proposed !== '') {
      next = { ...next, [key]: proposed };
    }
  }

  for (const { key } of LIST_LABELS) {
    const proposed = proposal[key]?.filter((item) => item.trim() !== '') ?? [];
    if ((next[key] ?? []).length === 0 && proposed.length > 0) {
      next = { ...next, [key]: [...proposed] };
    }
  }

  return next;
}

function hasProposalContent(proposal: SceneStructureProposal): boolean {
  return (
    SCALAR_LABELS.some(({ key }) => (proposal[key]?.trim() ?? '') !== '') ||
    LIST_LABELS.some(({ key }) => (proposal[key] ?? []).length > 0)
  );
}

export function SceneStructurePanel({
  card,
  documentUri,
  vscodeApi,
  updateCard,
  onStatusChange,
}: {
  readonly card: SceneCard;
  readonly documentUri: string;
  readonly vscodeApi: VscodeApi | undefined;
  readonly updateCard: (card: SceneCard) => void;
  readonly onStatusChange: (status: string) => void;
}): React.ReactElement {
  const [proposal, setProposal] = useState<SceneStructureProposal | undefined>();
  const [isRequesting, setIsRequesting] = useState(false);

  const canRequest = (card.summary?.trim() ?? '') !== '' && !isRequesting;

  const requestProposal = useCallback(async (): Promise<void> => {
    if (!vscodeApi) {
      return;
    }

    setIsRequesting(true);
    onStatusChange('summary에서 구조 필드를 제안받는 중입니다…');

    try {
      const response = await callRpc<{ readonly proposal: SceneStructureProposal }>(
        vscodeApi,
        'cards.structureScene',
        { uri: documentUri },
      );

      if (!hasProposalContent(response.proposal)) {
        setProposal(undefined);
        onStatusChange(
          '제안할 내용이 없습니다. 비어 있는 구조 필드가 없거나 summary가 부족합니다.',
        );
        return;
      }

      setProposal(response.proposal);
      onStatusChange('구조화 제안이 도착했습니다. 검토 후 반영하세요.');
    } catch (error) {
      setProposal(undefined);
      onStatusChange(error instanceof Error ? error.message : '구조화 제안에 실패했습니다.');
    } finally {
      setIsRequesting(false);
    }
  }, [documentUri, onStatusChange, vscodeApi]);

  const applyProposal = useCallback((): void => {
    if (!proposal) {
      return;
    }

    updateCard(applyStructureProposal(card, proposal));
    setProposal(undefined);
    onStatusChange('제안을 비어 있는 필드에 반영했습니다.');
  }, [card, onStatusChange, proposal, updateCard]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-sb-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm text-sb-fg-muted">
          AI 구조화 — summary를 읽고 비어 있는 구조 필드를 제안합니다.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={!canRequest}
          onClick={() => void requestProposal()}
        >
          {isRequesting ? '제안 중…' : 'Summary에서 구조화'}
        </Button>
      </div>

      {proposal ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-sb-border bg-sb-bg-widget/60 p-3"
          role="region"
          aria-label="구조화 제안"
        >
          {SCALAR_LABELS.filter(({ key }) => (proposal[key]?.trim() ?? '') !== '').map(
            ({ key, label }) => (
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2" key={key}>
                <span className="text-xs font-semibold text-sb-fg-muted">{label}</span>
                <span className="text-xs leading-normal text-sb-fg">{proposal[key]}</span>
              </div>
            ),
          )}
          {LIST_LABELS.filter(({ key }) => (proposal[key] ?? []).length > 0).map(
            ({ key, label }) => (
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2" key={key}>
                <span className="text-xs font-semibold text-sb-fg-muted">{label}</span>
                <span className="text-xs leading-normal text-sb-fg">
                  {(proposal[key] ?? []).join(' · ')}
                </span>
              </div>
            ),
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setProposal(undefined)}>
              닫기
            </Button>
            <Button type="button" variant="primary" onClick={applyProposal}>
              비어 있는 필드에 반영
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
