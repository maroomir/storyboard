export function personaKnowledgeView(
  name: string,
  characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined,
): { readonly hasKnowledge: boolean; readonly knowledge: readonly string[] } {
  const items: readonly string[] = characterKnowledge?.get(name) ?? [];

  return { hasKnowledge: items.length > 0, knowledge: items };
}
