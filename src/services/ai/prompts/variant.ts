import { type AiProviderId } from "@/services/ai/types"

import { type PromptVariantId } from "./types"

export function selectPromptVariant(providerId: AiProviderId): PromptVariantId {
  return providerId === "ollama" ? "xs" : "generic"
}
