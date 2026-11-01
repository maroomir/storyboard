export function personaSpeechView(
  name: string,
  speechToOthers: ReadonlyMap<string, readonly string[]> | undefined,
): { readonly hasSpeechToOthers: boolean; readonly speechToOthers: readonly string[] } {
  const items: readonly string[] = speechToOthers?.get(name) ?? [];

  return { hasSpeechToOthers: items.length > 0, speechToOthers: items };
}
