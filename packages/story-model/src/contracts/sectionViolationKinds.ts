export type SectionViolationKind =
  | 'cast'
  | 'place'
  | 'foreign-script'
  | 'lost-dialogue'
  | 'too-short'
  | 'too-long'
  | 'repeats-previous'
  | 'repetition'
  | 'dialogue-count'
  | 'scene-breaks'
  | 'runs-ahead'
  | 'missing-beats';

export const sectionViolationKinds: readonly [SectionViolationKind, ...SectionViolationKind[]] = [
  'cast',
  'place',
  'foreign-script',
  'lost-dialogue',
  'too-short',
  'too-long',
  'repeats-previous',
  'repetition',
  'dialogue-count',
  'scene-breaks',
  'runs-ahead',
  'missing-beats',
];

export type ViolationWeights = Readonly<Record<SectionViolationKind, number>>;
