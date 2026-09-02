import { Pencil, Sparkles, Trash2 } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { CostBadge } from '../ui/CostBadge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import {
  createRequestId,
  parseSidebarCardsInitialData,
  parseUsageChangedPayload,
  sumUsageMap,
  usageAmountOf,
} from '@webview/lib/messaging';
import { groupCharacterCardsByRole } from '@webview/lib/characterSidebarGroups';
import type {
  SidebarCardSummary,
  SidebarCardsInitialData,
  StoryboardEventMessage,
  SidebarRunnableCommand,
  StoryboardRequestMethod,
  UsageAmount,
} from '@webview/lib/types';

function SidebarCardRow({
  card,
  cardUsage,
  onOpen,
  onDelete,
}: {
  readonly card: SidebarCardSummary;
  readonly cardUsage: (card: SidebarCardSummary) => UsageAmount;
  readonly onOpen: (card: SidebarCardSummary) => void;
  readonly onDelete: (card: SidebarCardSummary) => void;
}): React.ReactElement {
  return (
    <li className="group/card overflow-hidden rounded-lg border border-sb-border bg-sb-bg-widget shadow-cardRest transition hover:border-sb-border-focus hover:shadow-cardHover">
      <div className="flex min-w-0 items-start gap-2 p-2.5">
        <button
          className="min-w-0 flex-1 cursor-pointer rounded-md border border-transparent bg-transparent p-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-sb-border-focus"
          type="button"
          onClick={() => onOpen(card)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold leading-snug text-sb-fg">{card.name}</span>
            <span className="shrink-0 rounded-full border border-sb-border bg-sb-bg-sidebar px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-sb-fg-muted">
              {card.type === 'character' ? '캐릭터' : '배경'}
            </span>
          </span>
          {card.error ? (
            <span className="mt-1 block line-clamp-2 text-xs leading-normal text-sb-fg-error">
              {card.error}
            </span>
          ) : card.description ? (
            <span className="mt-1 block line-clamp-2 text-xs leading-normal text-sb-fg-muted">
              {card.description}
            </span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <CostBadge usage={cardUsage(card)} />
          <Button
            type="button"
            variant="ghost"
            className="flex h-7 w-7 items-center justify-center p-0 text-sb-fg-muted hover:text-sb-fg"
            aria-label={`${card.name} 편집`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(card);
            }}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex h-7 w-7 items-center justify-center p-0 text-sb-fg-muted hover:text-sb-fg-error"
            aria-label={`${card.name} 삭제`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(card);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function CardsSidebar({
  initialData,
}: {
  readonly initialData: SidebarCardsInitialData;
}): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), []);
  const [sidebarState, setSidebarState] = useState(initialData);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== 'event') {
        return;
      }

      if (event.data.method === 'cards.listChanged') {
        setSidebarState(parseSidebarCardsInitialData(event.data.payload));
        return;
      }

      if (event.data.method === 'usage.changed') {
        setSidebarState((prev) => ({
          ...prev,
          usage: parseUsageChangedPayload(event.data.payload),
        }));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const postCardRequest = (
    method: StoryboardRequestMethod,
    payload: Record<string, unknown>,
  ): void => {
    vscodeApi?.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id: createRequestId(),
      method,
      payload,
    });
  };

  const runCommand = (command: SidebarRunnableCommand): void =>
    postCardRequest('workspace.runCommand', { command });

  const openCard = (card: SidebarCardSummary): void =>
    postCardRequest('cards.open', { uri: card.uri });
  const deleteCard = (card: SidebarCardSummary): void =>
    postCardRequest('cards.delete', { uri: card.uri });

  const kindLabel = sidebarState.type === 'character' ? '캐릭터' : '배경';
  const headerUsageTotal =
    sidebarState.type === 'character'
      ? sumUsageMap(sidebarState.usage.characters)
      : sumUsageMap(sidebarState.usage.backgrounds);

  const cardUsage = (card: SidebarCardSummary): UsageAmount => {
    const map =
      sidebarState.type === 'character'
        ? sidebarState.usage.characters
        : sidebarState.usage.backgrounds;
    return usageAmountOf(map, card.id);
  };

  const characterSections = useMemo(
    () => (sidebarState.type === 'character' ? groupCharacterCardsByRole(sidebarState.cards) : []),
    [sidebarState.cards, sidebarState.type],
  );

  const backgroundCards = useMemo(() => {
    if (sidebarState.type !== 'background') {
      return [];
    }
    return [...sidebarState.cards].sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }, [sidebarState.cards, sidebarState.type]);

  if (!sidebarState.isStoryboardProject) {
    return (
      <main className="@container flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
          Storyboard
        </p>
        <h1 className="font-display m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
        <EmptyState
          icon={Sparkles}
          title="아직 Storyboard 작품이 아닙니다"
          description="이 폴더에 작품 구조를 만들면 캐릭터와 배경 카드를 이 목록에서 관리할 수 있습니다."
          action={
            <Button type="button" onClick={() => runCommand('storyboard.init')}>
              작품 초기화
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <main className="@container flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
            Storyboard
          </p>
          <h1 className="font-display m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
        </div>
        <CostBadge usage={headerUsageTotal} className="shrink-0" />
      </div>

      {sidebarState.cards.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={`${kindLabel} 카드가 없습니다`}
          description={`빈 ${kindLabel} 카드를 만들어 채우거나, 씬을 먼저 쓰고 Studio의 /update 로 설명만 붙여 넣어도 카드가 생깁니다.`}
          action={
            <Button
              type="button"
              onClick={() =>
                runCommand(
                  sidebarState.type === 'character'
                    ? 'storyboard.character.create'
                    : 'storyboard.background.create',
                )
              }
            >
              새 {kindLabel} 카드
            </Button>
          }
        />
      ) : sidebarState.type === 'character' ? (
        <div className="flex flex-col gap-3" aria-label={`${sidebarState.title} card list`}>
          {characterSections.map((section) => (
            <details
              key={section.key}
              className="group overflow-hidden rounded-lg border border-sb-border bg-sb-bg-sidebar/80"
              open
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 transition hover:bg-sb-bg-list-hover [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="text-xs text-sb-fg-muted transition group-open:rotate-90"
                    aria-hidden
                  >
                    ›
                  </span>
                  <span className="text-sm font-semibold text-sb-fg">{section.label}</span>
                </span>
                <span className="shrink-0 rounded-full border border-sb-border bg-sb-bg-widget px-2 py-0.5 text-[0.65rem] font-medium text-sb-fg-muted">
                  {section.cards.length}
                </span>
              </summary>
              <ul className="m-0 flex list-none flex-col gap-2 border-t border-sb-border p-2">
                {section.cards.map((card) => (
                  <SidebarCardRow
                    key={card.uri}
                    card={card}
                    cardUsage={cardUsage}
                    onOpen={openCard}
                    onDelete={deleteCard}
                  />
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-2 p-0"
          aria-label={`${sidebarState.title} card list`}
        >
          {backgroundCards.map((card) => (
            <SidebarCardRow
              key={card.uri}
              card={card}
              cardUsage={cardUsage}
              onOpen={openCard}
              onDelete={deleteCard}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
