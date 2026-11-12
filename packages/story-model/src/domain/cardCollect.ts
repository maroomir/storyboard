import type {
  BackgroundCard,
  CharacterCard,
  CharacterRelation,
  StoryboardCard,
} from '#model/format/card';
import type { CardCollectProposal } from '#model/shared/cardCollect';
import { normalizeCardListText } from '#model/element/statementText';

function addUnique(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}

function hasCardListText(list: readonly string[], value: string): boolean {
  const normalized: string = normalizeCardListText(value);

  return list.some((item) => normalizeCardListText(item) === normalized);
}

export function addUniqueCardListText(list: readonly string[], value: string): string[] {
  return hasCardListText(list, value) ? [...list] : [...list, value];
}

function attributeValueAsString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === 'string' ? value : String(value);
}

type CharacterListField = 'traits' | 'description' | 'voice' | 'desire' | 'aliases';

type CharacterListProposalKind =
  | 'trait'
  | 'alias'
  | 'descriptionLine'
  | 'voiceLine'
  | 'desireLine';

type CharacterListProposal = Extract<CardCollectProposal, { kind: CharacterListProposalKind }>;
type RelationProposal = Extract<CardCollectProposal, { kind: 'relation' }>;
type RelationSpeechProposal = Extract<CardCollectProposal, { kind: 'relationSpeech' }>;
type ArcProposal = Extract<CardCollectProposal, { kind: 'arc' }>;

const characterListFieldByKind: Readonly<Record<CharacterListProposalKind, CharacterListField>> = {
  trait: 'traits',
  alias: 'aliases',
  descriptionLine: 'description',
  voiceLine: 'voice',
  desireLine: 'desire',
};

const characterListFieldsInCardOrder: readonly CharacterListField[] = [
  'traits',
  'description',
  'voice',
  'desire',
  'aliases',
];

function isCharacterListProposal(proposal: CardCollectProposal): proposal is CharacterListProposal {
  return proposal.kind in characterListFieldByKind;
}

class CharacterCardEdit {
  private readonly attributes: Record<string, string | number | boolean | null>;
  private readonly relations: CharacterRelation[];
  private arc: string | undefined;
  private readonly lists: Record<CharacterListField, string[]>;

  public constructor(private readonly card: CharacterCard) {
    this.attributes = { ...(card.attributes ?? {}) };
    this.relations = [...(card.relations ?? [])];
    this.arc = card.arc;
    this.lists = {
      traits: [...(card.traits ?? [])],
      description: [...(card.description ?? [])],
      voice: [...(card.voice ?? [])],
      desire: [...(card.desire ?? [])],
      aliases: [...(card.aliases ?? [])],
    };
  }

  public applyProposal(proposal: CardCollectProposal): void {
    if (isCharacterListProposal(proposal)) {
      const field: CharacterListField = characterListFieldByKind[proposal.kind];
      this.lists[field] = addUniqueCardListText(this.lists[field], proposal.value);
      return;
    }

    switch (proposal.kind) {
      case 'attribute':
        this.attributes[proposal.key] = proposal.value;
        break;
      case 'relation':
        this.upsertRelation(proposal);
        break;
      case 'relationSpeech':
        this.upsertRelationSpeech(proposal);
        break;
      case 'arc':
        this.upsertArc(proposal);
        break;
      default:
        break;
    }
  }

  public toCard(): CharacterCard {
    const filledLists: Partial<Pick<CharacterCard, CharacterListField>> = Object.fromEntries(
      characterListFieldsInCardOrder
        .filter((field: CharacterListField): boolean => this.lists[field].length > 0)
        .map((field: CharacterListField): [CharacterListField, string[]] => [
          field,
          this.lists[field],
        ]),
    );

    return {
      ...this.card,
      ...(Object.keys(this.attributes).length > 0 ? { attributes: this.attributes } : {}),
      ...(this.relations.length > 0 ? { relations: this.relations } : {}),
      ...(this.arc === undefined ? {} : { arc: this.arc }),
      ...filledLists,
    };
  }

  private upsertRelation(proposal: RelationProposal): void {
    const index: number = this.findRelationIndex(proposal.target);
    const existingSpeech: string | undefined = this.relations[index]?.speech;
    const relation: CharacterRelation = {
      target: proposal.target,
      type: proposal.type,
      ...(existingSpeech === undefined ? {} : { speech: existingSpeech }),
    };
    if (index >= 0) {
      this.relations[index] = relation;
    } else {
      this.relations.push(relation);
    }
  }

  private upsertRelationSpeech(proposal: RelationSpeechProposal): void {
    const index: number = this.findRelationIndex(proposal.target);
    const existing: CharacterRelation | undefined = this.relations[index];
    if (existing !== undefined) {
      this.relations[index] = { ...existing, speech: proposal.speech };
    } else if (proposal.type !== undefined) {
      this.relations.push({ target: proposal.target, type: proposal.type, speech: proposal.speech });
    }
  }

  private findRelationIndex(target: string): number {
    return this.relations.findIndex((existing) => existing.target === target);
  }

  private upsertArc(proposal: ArcProposal): void {
    this.arc = proposal.summary;
  }
}

function applyToCharacter(
  card: CharacterCard,
  accepted: readonly CardCollectProposal[],
): CharacterCard {
  const edit: CharacterCardEdit = new CharacterCardEdit(card);
  for (const proposal of accepted) {
    edit.applyProposal(proposal);
  }

  return edit.toCard();
}

type BackgroundListField = 'description' | 'senses' | 'layout' | 'rules' | 'aliases' | 'tags';

type BackgroundListProposalKind =
  | 'descriptionLine'
  | 'sense'
  | 'layoutLine'
  | 'ruleLine'
  | 'alias'
  | 'tag';

type BackgroundListProposal = Extract<CardCollectProposal, { kind: BackgroundListProposalKind }>;

const backgroundListFieldByKind: Readonly<Record<BackgroundListProposalKind, BackgroundListField>> =
  {
    descriptionLine: 'description',
    sense: 'senses',
    layoutLine: 'layout',
    ruleLine: 'rules',
    alias: 'aliases',
    tag: 'tags',
  };

const optionalBackgroundListFields: readonly Exclude<BackgroundListField, 'description'>[] = [
  'senses',
  'layout',
  'rules',
  'aliases',
  'tags',
];

function isBackgroundListProposal(
  proposal: CardCollectProposal,
): proposal is BackgroundListProposal {
  return proposal.kind in backgroundListFieldByKind;
}

function applyToBackground(
  card: BackgroundCard,
  accepted: readonly CardCollectProposal[],
): BackgroundCard {
  const lists: Record<BackgroundListField, string[]> = {
    description: [...(card.description ?? [])],
    senses: [...(card.senses ?? [])],
    layout: [...(card.layout ?? [])],
    rules: [...(card.rules ?? [])],
    aliases: [...(card.aliases ?? [])],
    tags: [...(card.tags ?? [])],
  };
  let characterIds: string[] = [...(card.characterIds ?? [])];
  let time: string | undefined = card.time;
  let weather: string | undefined = card.weather;

  for (const proposal of accepted) {
    if (isBackgroundListProposal(proposal)) {
      const field: BackgroundListField = backgroundListFieldByKind[proposal.kind];
      lists[field] = addUniqueCardListText(lists[field], proposal.value);
    } else if (proposal.kind === 'characterId') {
      characterIds = addUnique(characterIds, proposal.value);
    } else if (proposal.kind === 'scalar' && proposal.field === 'time') {
      time = proposal.after;
    } else if (proposal.kind === 'scalar') {
      weather = proposal.after;
    }
  }

  const filledLists: Partial<Pick<BackgroundCard, BackgroundListField>> = Object.fromEntries(
    optionalBackgroundListFields
      .filter((field): boolean => lists[field].length > 0)
      .map((field): [BackgroundListField, string[]] => [field, lists[field]]),
  );

  return {
    ...card,
    description: lists.description,
    characterIds,
    ...filledLists,
    ...(time ? { time } : {}),
    ...(weather ? { weather } : {}),
  };
}

export function applyCardCollectProposals(
  card: StoryboardCard,
  accepted: readonly CardCollectProposal[],
): StoryboardCard {
  return card.type === 'character'
    ? applyToCharacter(card, accepted)
    : applyToBackground(card, accepted);
}

function isNewListValue(list: readonly string[] | undefined, value: string): boolean {
  return !(list ?? []).includes(value);
}

function isNewListText(list: readonly string[] | undefined, value: string): boolean {
  return !hasCardListText(list ?? [], value);
}

function shouldProposeCharacterChange(card: CharacterCard, proposal: CardCollectProposal): boolean {
  if (isCharacterListProposal(proposal)) {
    return isNewListText(card[characterListFieldByKind[proposal.kind]], proposal.value);
  }

  switch (proposal.kind) {
    case 'attribute': {
      const current: string | undefined = attributeValueAsString(card.attributes?.[proposal.key]);
      return current !== proposal.value;
    }
    case 'relation': {
      const current: CharacterRelation | undefined = (card.relations ?? []).find(
        (relation) => relation.target === proposal.target,
      );
      return current?.type !== proposal.type;
    }
    case 'relationSpeech': {
      const current: CharacterRelation | undefined = (card.relations ?? []).find(
        (relation) => relation.target === proposal.target,
      );
      const canCreateRelation: boolean = current === undefined && proposal.type !== undefined;
      return canCreateRelation || (current !== undefined && current.speech !== proposal.speech);
    }
    case 'arc':
      return card.arc !== proposal.summary;
    default:
      return false;
  }
}

function shouldProposeBackgroundChange(
  card: BackgroundCard,
  proposal: CardCollectProposal,
): boolean {
  switch (proposal.kind) {
    case 'alias':
      return isNewListText(card.aliases, proposal.value);
    case 'tag':
      return isNewListText(card.tags, proposal.value);
    case 'descriptionLine':
      return isNewListText(card.description, proposal.value);
    case 'sense':
      return isNewListText(card.senses, proposal.value);
    case 'layoutLine':
      return isNewListText(card.layout, proposal.value);
    case 'ruleLine':
      return isNewListText(card.rules, proposal.value);
    case 'characterId':
      return isNewListValue(card.characterIds, proposal.value);
    case 'scalar':
      return (proposal.field === 'time' ? card.time : card.weather) !== proposal.after;
    default:
      return false;
  }
}

export function shouldProposeCardCollect(
  card: StoryboardCard,
  proposal: CardCollectProposal,
): boolean {
  return card.type === 'character'
    ? shouldProposeCharacterChange(card, proposal)
    : shouldProposeBackgroundChange(card, proposal);
}
