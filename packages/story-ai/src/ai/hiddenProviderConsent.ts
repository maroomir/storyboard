import {
  formatSubscriptionRiskNotice,
  subscriptionRiskNoticeQuestion,
  subscriptionRiskNoticeTitle,
  type AiProviderId,
} from '@storyboard/story-model';
import type { ConfigBridge } from '#ai/ports/ConfigBridge';

export interface HiddenProviderConsentQuestion {
  readonly providerId: AiProviderId;
  readonly title: string;
  // The numbered risks, one per line pair.
  readonly detail: string;
  readonly acceptLabel: string;
}

// A host with a window asks here when the home file switched a hidden provider on by hand, before
// anyone agreed to its risks. Yes is remembered and never asked again; no switches the provider
// back off, so the question is not repeated at every start either.
export async function requestHiddenProviderConsent(
  configBridge: ConfigBridge,
  ask: (question: HiddenProviderConsentQuestion) => Promise<boolean>,
): Promise<void> {
  for (const providerId of configBridge.getEnabledHiddenProviderIds()) {
    if (configBridge.isHiddenProviderRiskAcknowledged(providerId)) {
      continue;
    }

    const isAccepted = await ask({
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
