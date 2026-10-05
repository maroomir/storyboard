import {
  hiddenProviderEnabledKey,
  hiddenProviderIds,
  subscriptionRiskNoticeItems,
  subscriptionRiskNoticeQuestion,
  subscriptionRiskNoticeTitle,
  subscriptionRiskWarning,
  unknownProviderMessage,
  type AiProviderId,
} from '@storyboard/story-model';

import type { CliContainer } from '@/container';

import type { CommandOutcome } from './outcome';

const booleanWords: Readonly<Record<string, boolean>> = { true: true, false: false };

function riskNoticeLines(): string[] {
  return subscriptionRiskNoticeItems.flatMap((item, index) => [
    `${index + 1}. ${item.title}`,
    `   ${item.detail}`,
  ]);
}

// The one question a one-shot command asks: nobody but the person whose subscription it is can
// accept these risks, so there is no flag that answers for them and no answer without a terminal.
async function switchOn(
  container: CliContainer,
  providerId: AiProviderId,
): Promise<CommandOutcome> {
  const { configBridge, prompter } = container;
  const key = hiddenProviderEnabledKey(providerId);

  if (!configBridge.isHiddenProviderRiskAcknowledged(providerId)) {
    if (prompter === undefined) {
      return {
        ok: false,
        message:
          '이 설정은 위험 고지를 읽고 직접 동의해야 켤 수 있습니다. 터미널에서 다시 실행하세요.',
      };
    }

    const isAccepted = await prompter.choose({
      title: subscriptionRiskNoticeTitle,
      details: riskNoticeLines(),
      options: [
        { label: '아니요, 켜지 않습니다', value: false },
        { label: `예 — ${subscriptionRiskNoticeQuestion}`, value: true },
      ],
    });

    if (isAccepted !== true) {
      return { ok: false, message: '켜지 않았습니다. 설정은 바뀌지 않았습니다.' };
    }

    await configBridge.acknowledgeHiddenProviderRisk(providerId);
  }

  await configBridge.setHiddenProviderEnabled(providerId, true);
  container.logger.warn(subscriptionRiskWarning);

  return {
    ok: true,
    message: `${key} = true 저장했습니다: ${container.homePaths.configFile}`,
    data: { key, value: true },
  };
}

// The hidden providers' own keys. They live in the home file whatever `--global` says, and none of
// them is a name until the switch is on — except the switch itself.
export async function setHiddenProviderKey(
  container: CliContainer,
  key: string,
  raw: string,
): Promise<CommandOutcome | undefined> {
  const providerId = hiddenProviderIds.find((id) => key.startsWith(`providers.${id}.`));

  if (providerId === undefined) {
    return undefined;
  }

  const { configBridge } = container;
  const field = key.slice(`providers.${providerId}.`.length);

  if (field === 'enabled') {
    const isEnabled = booleanWords[raw];

    if (isEnabled === undefined) {
      return { ok: false, message: `${key} 는 true 또는 false 여야 합니다.` };
    }

    if (isEnabled) {
      return switchOn(container, providerId);
    }

    await configBridge.setHiddenProviderEnabled(providerId, false);
    return {
      ok: true,
      message: `${key} = false 저장했습니다: ${container.homePaths.configFile}`,
      data: { key, value: false },
    };
  }

  if (!configBridge.isHiddenProviderEnabled(providerId)) {
    return { ok: false, message: unknownProviderMessage(providerId) };
  }

  if (field === 'command') {
    await configBridge.setCliProviderConfig(providerId, { command: raw });
  } else if (field === 'timeoutMs') {
    const timeoutMs = Number(raw);

    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return { ok: false, message: `${key} 는 0보다 큰 정수(밀리초)여야 합니다.` };
    }

    await configBridge.setCliProviderConfig(providerId, { timeoutMs });
  } else {
    // `model` and anything else go the way every provider's keys go.
    return undefined;
  }

  return {
    ok: true,
    message: `${key} = ${raw} 저장했습니다: ${container.homePaths.configFile}`,
    data: { key, value: raw },
  };
}

export interface HiddenProviderCheck {
  readonly status: 'ok' | 'fail';
  readonly label: string;
  readonly detail: string;
  readonly fix?: string;
}

// What `doctor` adds when the default provider is a hidden one: whether its risks were accepted,
// and whether the executable is there and signed in — asked of the executable itself.
export async function collectHiddenProviderChecks(
  container: CliContainer,
  providerId: AiProviderId,
): Promise<HiddenProviderCheck[]> {
  if (!container.configBridge.isHiddenProviderRiskAcknowledged(providerId)) {
    return [
      {
        status: 'fail',
        label: '위험 고지',
        detail: '아직 동의하지 않았습니다. 생성 명령이 거부됩니다.',
        fix: `storyboard config set ${hiddenProviderEnabledKey(providerId)} true`,
      },
    ];
  }

  try {
    await container.aiProviderRegistry.checkConnection(providerId);
    return [{ status: 'ok', label: '구독 로그인', detail: '실행 파일이 로그인돼 있습니다.' }];
  } catch (error) {
    return [
      {
        status: 'fail',
        label: '구독 로그인',
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
