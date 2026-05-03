export const SituationExtractionPrompt = {
  config: {
    temperature: 0.3,
    maxTokens: 1000
  },
  build(input: string): string {
    return [
      "Analyze the user's input text and extract all situations and the characters participating in each situation.",
      "Return a JSON array in Korean.",
      "Each item must have characters and situation fields.",
      "The situation field should preserve the original segment text whenever possible.",
      "Example: [{\"characters\":[\"철수\"],\"situation\":\"철수가 교실에 들어왔다.\"}]",
      "",
      "User Input:",
      input,
      "",
      "Output only the JSON array."
    ].join("\n")
  }
} as const
