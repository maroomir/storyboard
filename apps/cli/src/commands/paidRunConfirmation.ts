import type { CommandOutcome } from '@/commands/outcome';
import type { CliContainer } from '@/container';
import type { WorkspaceStatus } from '@storyboard/story-app';
import type { AiProviderId } from '@storyboard/story-model';

function describeModel(container: CliContainer): string {
  const { configBridge } = container;
  const provider: AiProviderId = configBridge.getDefaultProvider();
  const model: string | undefined = configBridge.getProviderConfig(provider).model;
  return model === undefined ? provider : `${provider} · ${model}`;
}

interface PaidRunSummary {
  readonly title: string;
  readonly details: readonly string[];
}

export async function confirmPaidRun(
  container: CliContainer,
  summarize: (status: WorkspaceStatus) => PaidRunSummary,
): Promise<boolean> {
  const { prompter } = container;

  if (prompter === undefined || !prompter.shouldConfirmPaidRuns) {
    return true;
  }

  const { title, details } = summarize(await container.describeWorkspace());
  const answer: boolean | undefined = await prompter.choose({
    title,
    details: [...details, `모델  ${describeModel(container)}`],
    options: [
      { label: '진행', value: true },
      { label: '취소', value: false },
    ],
  });
  return answer === true;
}

export const cancelledBeforeRun: CommandOutcome = {
  ok: false,
  message: '취소했습니다. 아무것도 생성하지 않았습니다.',
  stop: 'cancelled',
};
