export type BotProviderId = "mock" | "claude-code" | "codex"

export type BotHealth = "unconfigured" | "dashboard-disabled" | "offline" | "online"

interface BotWorkspaceCandidate {
  readonly path: string
  readonly hasProject: boolean
  readonly isConnected: boolean
}

export interface BotConfigSnapshot {
  readonly configured: boolean
  readonly configFile: string
  readonly tokenHint: string | null
  readonly allowedChatIds: readonly number[]
  readonly allowedUserIds: readonly number[]
  readonly workspacePath: string | null
  readonly remote: string | null
  readonly defaultProvider: BotProviderId | null
  readonly dashboardPort: number | null
  readonly workspaceCandidates: readonly BotWorkspaceCandidate[]
  readonly health: BotHealth
}

export function parseBotConfigSnapshot(value: unknown): BotConfigSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.configured !== "boolean" || typeof candidate.configFile !== "string") {
    return undefined
  }
  if (!Array.isArray(candidate.workspaceCandidates) || typeof candidate.health !== "string") {
    return undefined
  }

  return candidate as unknown as BotConfigSnapshot
}

// Accepts what a person types into a chat-id field — comma or space separated, negatives allowed
// for group chats — and refuses anything it cannot turn into an exact integer list.
export function parseChatIdList(input: string): number[] | undefined {
  const tokens = input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  if (tokens.length === 0) {
    return []
  }

  const ids: number[] = []
  for (const token of tokens) {
    if (!/^-?\d+$/.test(token)) {
      return undefined
    }
    ids.push(Number(token))
  }
  return ids
}

export function formatChatIdList(ids: readonly number[]): string {
  return ids.join(", ")
}

export const BOT_HEALTH_LABELS: Record<BotHealth, string> = {
  unconfigured: "설정 없음",
  "dashboard-disabled": "대시보드 꺼짐",
  offline: "중지됨",
  online: "실행 중"
}
