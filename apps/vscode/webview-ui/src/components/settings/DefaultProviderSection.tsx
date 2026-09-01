import React, { useState } from 'react';

import { SectionHeader } from '../ui/SectionHeader';
import { StatusPill } from './SettingsPrimitives';
import {
  AI_PROVIDER_IDS,
  getProviderStatus,
  isAiProviderId,
  pickModelForTaskProvider,
  type SettingsReadSnapshot,
} from './settingsSnapshot';
import { sbSelectClass, sectionCardClass } from './settingsStyles';

export function DefaultProviderSection({
  snapshot,
  callRpc,
  onRpcError,
}: {
  readonly snapshot: SettingsReadSnapshot;
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
  readonly onRpcError: (message: string) => void;
}): React.ReactElement {
  const [pending, setPending] = useState(false);
  const defaultProviderId = snapshot.defaultProvider;
  const selectedProvider = getProviderStatus(snapshot, defaultProviderId);
  const defaultModelCatalog = snapshot.modelCatalog[defaultProviderId];
  const defaultModelSelectValue = pickModelForTaskProvider(
    snapshot,
    defaultProviderId,
    snapshot.providerConfigs[defaultProviderId].model,
  );

  return (
    <section className={sectionCardClass} aria-label="기본 AI 제공자와 모델">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="기본 제공자와 모델"
          description="태스크가 «기본값 사용»일 때 쓰는 제공자와, 그 제공자의 기본 모델입니다. 모델은 아래 태스크에서 다른 값으로 덮어쓸 수 있습니다."
        />
        <StatusPill tone="success">{selectedProvider?.displayName ?? defaultProviderId}</StatusPill>
      </div>
      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-sb-fg">기본 제공자</span>
          <select
            className={sbSelectClass}
            value={defaultProviderId}
            disabled={pending}
            onChange={(event) => {
              const providerId = event.target.value;
              if (!isAiProviderId(providerId)) {
                return;
              }

              setPending(true);
              void callRpc('settings.updateDefaultProvider', { providerId })
                .catch((error: unknown) => {
                  onRpcError(
                    error instanceof Error ? error.message : '기본 제공자를 바꾸지 못했습니다.',
                  );
                })
                .finally(() => {
                  setPending(false);
                });
            }}
          >
            {AI_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {getProviderStatus(snapshot, id)?.displayName ?? id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-sb-fg">기본 모델</span>
          <select
            className={sbSelectClass}
            value={defaultModelSelectValue}
            disabled={pending}
            onChange={(event) => {
              const model = event.target.value;
              if (model.length === 0) {
                return;
              }

              setPending(true);
              void callRpc('settings.updateProviderModel', { providerId: defaultProviderId, model })
                .catch((error: unknown) => {
                  onRpcError(
                    error instanceof Error ? error.message : '기본 모델을 바꾸지 못했습니다.',
                  );
                })
                .finally(() => {
                  setPending(false);
                });
            }}
          >
            {defaultModelCatalog.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
