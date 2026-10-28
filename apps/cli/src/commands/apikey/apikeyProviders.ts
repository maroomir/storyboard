import { availableProviderIds } from '@/adapters/availableProviders';
import { askLine } from '@/commands/prompt';
import type { CliContainer } from '@/container';
import { requiresApiKey, type AiProviderId } from '@storyboard/story-model';

export async function resolveApiKeyProvider(
  container: CliContainer,
  given: string | undefined,
): Promise<string | undefined> {
  if (given !== undefined) {
    return availableProviderIds().includes(given as AiProviderId)
      ? given
      : `모르는 프로바이더입니다: ${given}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
  }
  if (!process.stdin.isTTY || !container.canPrompt) {
    return undefined;
  }

  const candidates: AiProviderId[] = availableProviderIds().filter((providerId) =>
    requiresApiKey(providerId),
  );
  process.stderr.write('어느 프로바이더의 API 키입니까?\n');
  candidates.forEach((providerId, index) => {
    process.stderr.write(`  ${index + 1}. ${providerId}\n`);
  });
  const answer: string = await askLine('번호 또는 이름: ');
  const byIndex: AiProviderId | undefined = candidates[Number(answer) - 1];

  return byIndex ?? (candidates.includes(answer as AiProviderId) ? answer : undefined);
}
