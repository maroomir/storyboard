import React from 'react';

import { Button } from '../ui/Button';
import {
  AI_PROVIDER_IDS,
  getProviderStatus,
  hasTaskOverride,
  requiresApiKey,
  type SettingsReadSnapshot,
} from './settingsSnapshot';

const summaryCardClass =
  'flex flex-col gap-1 rounded-lg border border-sb-border bg-sb-bg-widget/70 px-3 py-2.5';
const summaryLabelClass =
  'm-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sb-fg-muted';
const summaryValueClass = 'text-base font-semibold leading-tight text-sb-fg';
const summaryLinkClass = 'self-start px-0 py-0 text-xs';

export function SettingsSummaryCards({
  snapshot,
  onNavigate,
}: {
  readonly snapshot: SettingsReadSnapshot;
  readonly onNavigate: (tabId: string) => void;
}): React.ReactElement {
  const defaultProviderId = snapshot.defaultProvider;
  const defaultProviderName =
    getProviderStatus(snapshot, defaultProviderId)?.displayName ?? defaultProviderId;
  const defaultModelId = snapshot.providerConfigs[defaultProviderId].model;
  const defaultModelName =
    snapshot.modelCatalog[defaultProviderId].find((entry) => entry.id === defaultModelId)
      ?.displayName ?? defaultModelId;

  const keyedProviders = AI_PROVIDER_IDS.filter(requiresApiKey);
  const connectedCount = keyedProviders.filter(
    (id) => getProviderStatus(snapshot, id)?.hasApiKey === true,
  ).length;

  const overrideCount = snapshot.taskCatalog.filter((task) =>
    hasTaskOverride(snapshot, task.name),
  ).length;
  const defaultTaskCount = snapshot.taskCatalog.length - overrideCount;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="설정 요약">
      <article className={summaryCardClass}>
        <p className={summaryLabelClass}>기본 AI</p>
        {snapshot.isDefaultProviderConfigured ? (
          <>
            <span className={summaryValueClass}>{defaultProviderName}</span>
            <span className="text-xs text-sb-fg-muted">{defaultModelName}</span>
          </>
        ) : (
          <>
            <span className={summaryValueClass}>선택 필요</span>
            <span className="text-xs text-amber-500">
              고르기 전에는 생성이 실행되지 않습니다
            </span>
          </>
        )}
        <Button variant="ghost" className={summaryLinkClass} onClick={() => onNavigate('defaults')}>
          변경 ›
        </Button>
      </article>

      <article className={summaryCardClass}>
        <p className={summaryLabelClass}>연결 상태</p>
        <span className={summaryValueClass}>
          {connectedCount} / {keyedProviders.length} 키 등록
        </span>
        <ul className="m-0 flex list-none flex-wrap gap-x-2.5 gap-y-1 p-0 text-xs text-sb-fg-muted">
          {keyedProviders.map((providerId) => {
            const status = getProviderStatus(snapshot, providerId);
            const isConnected = status?.hasApiKey === true;
            return (
              <li key={providerId} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-sb-accent-background' : 'bg-sb-border-warning'}`}
                />
                <span>{status?.displayName ?? providerId}</span>
              </li>
            );
          })}
        </ul>
        <Button
          variant="ghost"
          className={summaryLinkClass}
          onClick={() => onNavigate('connections')}
        >
          연결 관리 ›
        </Button>
      </article>

      <article className={summaryCardClass}>
        <p className={summaryLabelClass}>태스크 오버라이드</p>
        <span className={summaryValueClass}>{overrideCount}개 활성</span>
        <span className="text-xs text-sb-fg-muted">나머지 {defaultTaskCount}개는 기본값</span>
        <Button variant="ghost" className={summaryLinkClass} onClick={() => onNavigate('tasks')}>
          오버라이드 관리 ›
        </Button>
      </article>
    </div>
  );
}
