import {
  formatSubscriptionRiskNotice,
  requiresSubscriptionRiskNotice,
  subscriptionRiskNoticeQuestion,
  subscriptionRiskNoticeTitle,
  type AiProviderId,
} from '@storyboard/story-model';
import type { ConfigBridge } from '#ai/ports/ConfigBridge';

export interface HiddenProviderConsentQuestion {
  readonly providerId: AiProviderId;
  readonly title: string;
  readonly detail: string;
  readonly acceptLabel: string;
}

export async function requestHiddenProviderConsent(
  configBridge: ConfigBridge,
  ask: (question: HiddenProviderConsentQuestion) => Promise<boolean>,
): Promise<void> {
  for (const providerId of configBridge.getEnabledHiddenProviderIds()) {
    if (
      !requiresSubscriptionRiskNotice(providerId) ||
      configBridge.isHiddenProviderRiskAcknowledged(providerId)
    ) {
      continue;
    }

    const isAccepted: boolean = await ask({
      providerId,
      title: subscriptionRiskNoticeTitle,
      detail: formatSubscriptionRiskNotice().split('\n').slice(2).join('\n'),
      acceptLabel: `예 — ${subscriptionRiskNoticeQuestion}`,
    });

    if (isAccepted) {
      await configBridge.acknowledgeHiddenProviderRisk(providerId);
    } else {
      await configBridge.disableHiddenProvider(providerId);
    }
  }
}
