// 이름 → 아는 것. 페르소나 맵과 같은 열쇠로 뼈대·다듬기 프롬프트의 인물 블록에 실린다.
export function personaKnowledgeView(
  name: string,
  characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined,
): { readonly hasKnowledge: boolean; readonly knowledge: readonly string[] } {
  const items = characterKnowledge?.get(name) ?? [];

  return { hasKnowledge: items.length > 0, knowledge: items };
}
