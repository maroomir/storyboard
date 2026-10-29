import type {
  BackgroundCard,
  CharacterArc,
  CharacterCard,
  CharacterRelation,
  StoryboardCard,
} from '#model/format/card';
import type { CardCollectProposal } from '#model/shared/cardCollect';

function addUnique(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}

export function normalizeCardListText(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('ko')
    .replace(/[^\p{L}\p{N}]+/gu, '');
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

type CharacterListField =
  | 'traits'
  | 'recentDialogues'
  | 'description'
  | 'voice'
  | 'desire'
  | 'aliases'
  | 'tags';

type CharacterListProposalKind =
  | 'trait'
  | 'alias'
  | 'tag'
  | 'recentDialogue'
  | 'descriptionLine'
  | 'voiceLine'
  | 'desireLine';

type CharacterListProposal = Extract<CardCollectProposal, { kind: CharacterListProposalKind }>;
type RelationProposal = Extract<CardCollectProposal, { kind: 'relation' }>;
type ArcProposal = Extract<CardCollectProposal, { kind: 'arc' }>;

const characterListFieldByKind: Readonly<Record<CharacterListProposalKind, CharacterListField>> = {
  trait: 'traits',
  alias: 'aliases',
  tag: 'tags',
  recentDialogue: 'recentDialogues',
  descriptionLine: 'description',
  voiceLine: 'voice',
  desireLine: 'desire',
};

const characterListFieldsInCardOrder: readonly CharacterListField[] = [
  'traits',
  'recentDialogues',
  'description',
  'voice',
  'desire',
  'aliases',
  'tags',
];

function isCharacterListProposal(proposal: CardCollectProposal): proposal is CharacterListProposal {
  return proposal.kind in characterListFieldByKind;
}

class CharacterCardEdit {
  private readonly attributes: Record<string, string | number | boolean | null>;
  private readonly relations: CharacterRelation[];
  private readonly arc: CharacterArc[];
  private readonly lists: Record<CharacterListField, string[]>;

  public constructor(private readonly card: CharacterCard) {
    this.attributes = { ...(card.attributes ?? {}) };
    this.relations = [...(card.relations ?? [])];
    this.arc = [...(card.arc ?? [])];
    this.lists = {
      traits: [...(card.traits ?? [])],
      recentDialogues: [...(card.recentDialogues ?? [])],
      description: [...(card.description ?? [])],
      voice: [...(card.voice ?? [])],
      desire: [...(card.desire ?? [])],
      aliases: [...(card.aliases ?? [])],
      tags: [...(card.tags ?? [])],
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
      ...(this.arc.length > 0 ? { arc: this.arc } : {}),
      ...filledLists,
    };
  }

  private upsertRelation(proposal: RelationProposal): void {
    const relation: CharacterRelation = { target: proposal.target, type: proposal.type };
    const index: number = this.relations.findIndex(
      (existing) => existing.target === proposal.target,
    );
    if (index >= 0) {
      this.relations[index] = relation;
    } else {
      this.relations.push(relation);
    }
  }

  private upsertArc(proposal: ArcProposal): void {
    const index: number = this.arc.findIndex((entry) => entry.sceneRef === proposal.sceneRef);
    if (index >= 0) {
      this.arc[index] = {
        stage: this.arc[index]?.stage ?? proposal.sceneRef,
        summary: proposal.summary,
        sceneRef: proposal.sceneRef,
      };
    } else {
      this.arc.push({
        stage: proposal.stage ?? proposal.sceneRef,
        summary: proposal.summary,
        sceneRef: proposal.sceneRef,
      });
    }
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

function applyToBackground(
  card: BackgroundCard,
  accepted: readonly CardCollectProposal[],
): BackgroundCard {
  let description: string[] = [...(card.description ?? [])];
  let senses: string[] = [...(card.senses ?? [])];
  let characterIds: string[] = [...(card.characterIds ?? [])];
  let time: string | undefined = card.time;
  let weather: string | undefined = card.weather;
  let aliases: string[] = [...(card.aliases ?? [])];
  let tags: string[] = [...(card.tags ?? [])];

  for (const proposal of accepted) {
    if (proposal.kind === 'descriptionLine') {
      description = addUniqueCardListText(description, proposal.value);
    } else if (proposal.kind === 'sense') {
      senses = addUniqueCardListText(senses, proposal.value);
    } else if (proposal.kind === 'characterId') {
      characterIds = addUnique(characterIds, proposal.value);
    } else if (proposal.kind === 'scalar') {
      if (proposal.field === 'time') {
        time = proposal.after;
      } else {
        weather = proposal.after;
      }
    } else if (proposal.kind === 'alias') {
      aliases = addUniqueCardListText(aliases, proposal.value);
    } else if (proposal.kind === 'tag') {
      tags = addUniqueCardListText(tags, proposal.value);
    }
  }

  return {
    ...card,
    description,
    characterIds,
    ...(senses.length > 0 ? { senses } : {}),
    ...(time ? { time } : {}),
    ...(weather ? { weather } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(tags.length > 0 ? { tags } : {}),
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
    case 'arc': {
      const current: CharacterArc | undefined = (card.arc ?? []).find(
        (entry) => entry.sceneRef === proposal.sceneRef,
      );
      return current?.summary !== proposal.summary;
    }
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
