import {
  AiProviderError,
  extractErrorMessage,
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
import type { ChatGptProvider, FetchLike, OAuthConnection } from '@storyboard/story-ai';
import type { CliContainer } from '@/container';
import { createChatGptProvider } from '@/commands/loginProviders';
import type { CommandOutcome } from './outcome';
import { success } from './outcomes';
import { failure } from '@/commands/outcomes';
import type { DoctorCheck } from '@/commands/doctorCheck';

const booleanWords: Readonly<Record<string, boolean>> = { true: true, false: false };

function riskNoticeLines(): string[] {
  return subscriptionRiskNoticeItems.flatMap((item, index) => [
    `${index + 1}. ${item.title}`,
    `   ${item.detail}`,
  ]);
}

const previewCheck: DoctorCheck = {
  status: 'info',
  label: '미리보기',
  detail:
    '제공자가 미리보기로 연 경로입니다. 받는 파라미터와 한도 정책이 바뀔 수 있고, 금액이 계산되지 않아 실행 예산(budget.run.limitUsd)이 적용되지 않습니다.',
};

export class HiddenProviderSwitch {
  public constructor(private readonly container: CliContainer) {}

  private async switchOn(providerId: AiProviderId): Promise<CommandOutcome> {
    const { configBridge, prompter } = this.container;
    const key: string = hiddenProviderEnabledKey(providerId);

    if (!requiresSubscriptionRiskNotice(providerId)) {
      await configBridge.enableHiddenProvider(providerId);
      this.container.logger.warn(hiddenProviderRunWarning(providerId));

      return success(
        `${key} = true 저장했습니다: ${this.container.homePaths.configFile}\n다음: storyboard login ${providerId}`,
        { key, value: true },
      );
    }

    if (!configBridge.isHiddenProviderRiskAcknowledged(providerId)) {
      if (prompter === undefined) {
        return failure(
          '이 설정은 위험 고지를 읽고 직접 동의해야 켤 수 있습니다. 터미널에서 다시 실행하세요.',
        );
      }

      const isAccepted: boolean | undefined = await prompter.choose({
        title: subscriptionRiskNoticeTitle,
        details: riskNoticeLines(),
        options: [
          { label: '아니요, 켜지 않습니다', value: false },
          { label: `예 — ${subscriptionRiskNoticeQuestion}`, value: true },
        ],
      });

      if (isAccepted !== true) {
        return failure('켜지 않았습니다. 설정은 바뀌지 않았습니다.');
      }

      await configBridge.acknowledgeHiddenProviderRisk(providerId);
    }

    await configBridge.enableHiddenProvider(providerId);
    this.container.logger.warn(hiddenProviderRunWarning(providerId));

    return success(`${key} = true 저장했습니다: ${this.container.homePaths.configFile}`, {
      key,
      value: true,
    });
  }

  public async setKey(key: string, raw: string): Promise<CommandOutcome | undefined> {
    const providerId: AiProviderId | undefined = hiddenProviderIds.find((id) =>
      key.startsWith(`providers.${id}.`),
    );

    if (providerId === undefined) {
      return undefined;
    }

    const { configBridge } = this.container;
    const field: string = key.slice(`providers.${providerId}.`.length);

    if (field === 'enabled') {
      const isEnabled: boolean | undefined = booleanWords[raw];

      if (isEnabled === undefined) {
        return failure(`${key} 는 true 또는 false 여야 합니다.`);
      }

      if (isEnabled) {
        return this.switchOn(providerId);
      }

      const clearedKeys: readonly string[] = await configBridge.disableHiddenProvider(providerId);
      return success(
        [
          `${key} = false 저장했습니다: ${this.container.homePaths.configFile}`,
          ...(clearedKeys.length === 0
            ? []
            : [
                `이 프로바이더를 가리키던 설정도 지웠습니다(${clearedKeys.join(', ')}). 다시 고르세요: storyboard setup`,
              ]),
        ].join('\n'),
        { key, value: false, clearedKeys },
      );
    }

    if (!configBridge.isHiddenProviderEnabled(providerId)) {
      return failure(unknownProviderMessage(providerId));
    }

    if (getProviderTransport(providerId) !== 'cli') {
      return undefined;
    }

    if (field === 'command') {
      const command: string = raw.trim();

      if (command.length === 0) {
        return failure(`${key} 는 비워 둘 수 없습니다. 실행 파일의 경로를 적으세요.`);
      }

      await configBridge.setCliProviderConfig(providerId, { command });
    } else if (field === 'timeoutMs') {
      const timeoutMs: number = Number(raw);

      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        return failure(`${key} 는 0보다 큰 정수(밀리초)여야 합니다.`);
      }

      await configBridge.setCliProviderConfig(providerId, { timeoutMs });
    } else {
      return undefined;
    }

    return success(`${key} = ${raw} 저장했습니다: ${this.container.homePaths.configFile}`, {
      key,
      value: raw,
    });
  }

  public async checks(providerId: AiProviderId, fetchImpl?: FetchLike): Promise<DoctorCheck[]> {
    if (!requiresSubscriptionRiskNotice(providerId)) {
      return this.loginProviderChecks(providerId, fetchImpl);
    }

    if (!this.container.configBridge.isHiddenProviderRiskAcknowledged(providerId)) {
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
      await this.container.aiProviderRegistry.checkConnection(providerId);
      return [{ status: 'ok', label: '구독 로그인', detail: '실행 파일이 로그인돼 있습니다.' }];
    } catch (error) {
      return [
        {
          status: 'fail',
          label: '구독 로그인',
          detail: extractErrorMessage(error),
        },
      ];
    }
  }

  private async loginProviderChecks(
    providerId: AiProviderId,
    fetchImpl: FetchLike | undefined,
  ): Promise<DoctorCheck[]> {
    const { configBridge, secretStore } = this.container;
    const connection: OAuthConnection | undefined =
      await secretStore.getOAuthConnection(providerId);
    const model: string | undefined = configBridge.getProviderConfig(providerId).model;
    const loginFix: string = `storyboard login ${providerId}`;

    let provider: ChatGptProvider;
    try {
      provider = await createChatGptProvider(configBridge, secretStore, fetchImpl);
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
          detail: extractErrorMessage(error),
          fix: loginFix,
        },
      ];
    }

    const account: string | undefined = connection?.registration?.email;
    const slugs: string[] = models.map((entry) => entry.slug);

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
}
