// The ways an expanded section can be wrong, in the order the retry scale lists them. The scale
// (`generation.violationWeights.<kind>`) and the pipeline's validators must agree on these names,
// so they live below both.
export const sectionViolationKinds = [
  'cast',
  'foreign-script',
  'lost-dialogue',
  'too-short',
  'too-long',
  'repeats-previous',
  'repetition',
  'dialogue-count',
] as const;

export type SectionViolationKind = (typeof sectionViolationKinds)[number];

export type ViolationWeights = Readonly<Record<SectionViolationKind, number>>;
