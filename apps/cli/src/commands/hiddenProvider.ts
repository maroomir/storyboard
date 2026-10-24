import {
  AiProviderError,
  getProviderTransport,
  hiddenProviderEnabledKey,
  hiddenProviderIds,
  hiddenProviderRunWarning,
  requiresSubscriptionRiskNotice,
  subscriptionRiskNoticeItems,
  subscriptionRiskNoticeQuestion,
  subscriptionRiskNoticeTitle,
  unknownProviderMessage,
  type AiProviderId,
} from '@storyboard/story-model';
import type { ChatGptProvider, FetchLike } from '@storyboard/story-ai';

import type { CliContainer } from '@/container';

import { createChatGptProvider } from './login';

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
// The browser-login path has no such notice: the provider opened it officially, so the switch
// turns on at once and the next step is the login.
async function switchOn(
  container: CliContainer,
  providerId: AiProviderId,
): Promise<CommandOutcome> {
  const { configBridge, prompter } = container;
  const key = hiddenProviderEnabledKey(providerId);

  if (!requiresSubscriptionRiskNotice(providerId)) {
    await configBridge.enableHiddenProvider(providerId);
    container.logger.warn(hiddenProviderRunWarning(providerId));

    return {
      ok: true,
      message: `${key} = true 저장했습니다: ${container.homePaths.configFile}\n다음: storyboard login ${providerId}`,
      data: { key, value: true },
    };
  }

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

  await configBridge.enableHiddenProvider(providerId);
  container.logger.warn(hiddenProviderRunWarning(providerId));

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

    const clearedKeys = await configBridge.disableHiddenProvider(providerId);
    return {
      ok: true,
      message: [
        `${key} = false 저장했습니다: ${container.homePaths.configFile}`,
        ...(clearedKeys.length === 0
          ? []
          : [
              `이 프로바이더를 가리키던 설정도 지웠습니다(${clearedKeys.join(', ')}). 다시 고르세요: storyboard setup`,
            ]),
      ].join('\n'),
      data: { key, value: false, clearedKeys },
    };
  }

  if (!configBridge.isHiddenProviderEnabled(providerId)) {
    return { ok: false, message: unknownProviderMessage(providerId) };
  }

  // The executable keys belong to the program-run path; any other provider's go the common way.
  if (getProviderTransport(providerId) !== 'cli') {
    return undefined;
  }

  if (field === 'command') {
    const command = raw.trim();

    // The config schema rejects a blank command, and a file it rejects stops every later command —
    // including the one that would put it right.
    if (command.length === 0) {
      return { ok: false, message: `${key} 는 비워 둘 수 없습니다. 실행 파일의 경로를 적으세요.` };
    }

    await configBridge.setCliProviderConfig(providerId, { command });
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
  readonly status: 'ok' | 'warn' | 'fail' | 'info';
  readonly label: string;
  readonly detail: string;
  readonly fix?: string;
}

// What `doctor` adds when the default provider is a hidden one: for the program-run path whether
// its risks were accepted and the executable is signed in — asked of the executable itself; for
// the browser-login path whether a session is there and the configured model is one the account
// may call.
export async function collectHiddenProviderChecks(
  container: CliContainer,
  providerId: AiProviderId,
  fetchImpl?: FetchLike,
): Promise<HiddenProviderCheck[]> {
  if (!requiresSubscriptionRiskNotice(providerId)) {
    return collectLoginProviderChecks(container, providerId, fetchImpl);
  }

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

const previewCheck: HiddenProviderCheck = {
  status: 'info',
  label: '미리보기',
  detail:
    '제공자가 미리보기로 연 경로입니다. 받는 파라미터와 한도 정책이 바뀔 수 있고, 금액이 계산되지 않아 실행 예산(budget.run.limitUsd)이 적용되지 않습니다.',
};

// The model list is the account's, not the catalog's, so the configured model is checked against
// what the account actually offers — a warning, since the list may change under us.
async function collectLoginProviderChecks(
  container: CliContainer,
  providerId: AiProviderId,
  fetchImpl: FetchLike | undefined,
): Promise<HiddenProviderCheck[]> {
  const { configBridge, secretStore } = container;
  const connection = await secretStore.getOAuthConnection(providerId);
  const model = configBridge.getProviderConfig(providerId).model;
  const loginFix = `storyboard login ${providerId}`;

  let provider: ChatGptProvider;
  try {
    provider = await createChatGptProvider(container, fetchImpl);
  } catch (error) {
    return [
      previewCheck,
      {
        status: 'fail',
        label: '로그인',
        detail:
          error instanceof AiProviderError && error.code === 'login-required'
            ? '로그인돼 있지 않습니다. 생성 명령이 거부됩니다.'
            : error instanceof Error
              ? error.message
              : String(error),
        fix: loginFix,
      },
    ];
  }

  let models: readonly { readonly slug: string }[];
  try {
    models = await provider.listModels();
  } catch (error) {
    return [
      previewCheck,
      {
        status: 'fail',
        label: '로그인',
        detail: error instanceof Error ? error.message : String(error),
        fix: loginFix,
      },
    ];
  }

  const account = connection?.registration?.email;
  const slugs = models.map((entry) => entry.slug);

  return [
    previewCheck,
    {
      status: 'ok',
      label: '로그인',
      detail: `${account === undefined ? '계정' : account} 으로 로그인돼 있습니다.`,
    },
    ...(model !== undefined && slugs.length > 0 && !slugs.includes(model)
      ? [
          {
            status: 'warn' as const,
            label: '모델',
            detail: `${model} 이 이 계정의 모델 목록에 없습니다 (${slugs.slice(0, 6).join(', ')}${slugs.length > 6 ? ', …' : ''}). 호출이 거부될 수 있습니다.`,
            fix: `storyboard config set providers.${providerId}.model <model> --global`,
          },
        ]
      : []),
  ];
}
