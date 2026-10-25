import { formatUsd } from '@storyboard/story-model/contracts';
import type { UsageAmount } from '@webview/lib/types';

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return '0';
  }

  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }

  return String(Math.round(tokens));
}

export function isEmptyUsageDisplay(usage: UsageAmount): boolean {
  return usage.tokens <= 0 && usage.costUsd <= 0;
}

export function formatUsageBadgeLabel(usage: UsageAmount): string {
  if (isEmptyUsageDisplay(usage)) {
    return '—';
  }

  const tokens: string = formatTokenCount(usage.tokens);

  if (usage.hasUnpricedUsage && usage.costUsd <= 0) {
    return `${tokens} 토큰`;
  }

  return usage.tokens > 0 ? `${formatUsd(usage.costUsd)} · ${tokens}` : formatUsd(usage.costUsd);
}

export function formatUsageBadgeTooltip(usage: UsageAmount): string {
  if (isEmptyUsageDisplay(usage)) {
    return '아직 AI 사용 기록이 없습니다';
  }

  const parts: string[] = [`입력+출력 ${Math.round(usage.tokens).toLocaleString()} 토큰`];

  if (usage.costUsd > 0) {
    parts.unshift(`USD ${usage.costUsd.toFixed(6)}`);
  }

  if (usage.hasUnpricedUsage) {
    parts.push('구독형 프로바이더 사용분은 달러로 환산되지 않습니다');
  }

  if (usage.cache !== undefined && usage.cache.promptTokens > 0 && usage.cache.cachedTokens > 0) {
    const rate: number = Math.round((usage.cache.cachedTokens / usage.cache.promptTokens) * 100);
    parts.push(`프롬프트 캐시 적중 ${rate}% · 절약 ${formatUsd(usage.cache.savedUsd)}`);
  }

  return parts.join(' · ');
}
