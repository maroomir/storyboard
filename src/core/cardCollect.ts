import type {
  BackgroundCard,
  CharacterCard,
  CharacterRelation,
  StoryboardCard,
} from '../shared/card';
import type { CardCollectProposal } from '../shared/cardCollect';

function addUnique(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}

function attributeValueAsString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === 'string' ? value : String(value);
}

function applyToCharacter(
  card: CharacterCard,
  accepted: readonly CardCollectProposal[],
): CharacterCard {
  const attributes = { ...(card.attributes ?? {}) };
  const relations: CharacterRelation[] = [...(card.relations ?? [])];
  const arc = [...(card.arc ?? [])];
  let traits = [...(card.traits ?? [])];
  let recentDialogues = [...(card.recentDialogues ?? [])];
  let description = [...(card.description ?? [])];
  let voice = [...(card.voice ?? [])];
  let desire = [...(card.desire ?? [])];

  for (const proposal of accepted) {
    switch (proposal.kind) {
      case 'attribute':
        attributes[proposal.key] = proposal.value;
        break;
      case 'relation': {
        const index = relations.findIndex((relation) => relation.target === proposal.target);
        if (index >= 0) {
          relations[index] = { target: proposal.target, type: proposal.type };
        } else {
          relations.push({ target: proposal.target, type: proposal.type });
        }
        break;
      }
      case 'arc': {
        const index = arc.findIndex((entry) => entry.sceneRef === proposal.sceneRef);
        if (index >= 0) {
          arc[index] = {
            stage: arc[index]?.stage ?? proposal.sceneRef,
            summary: proposal.summary,
            sceneRef: proposal.sceneRef,
          };
        } else {
          arc.push({
            stage: proposal.stage ?? proposal.sceneRef,
            summary: proposal.summary,
            sceneRef: proposal.sceneRef,
          });
        }
        break;
      }
      case 'trait':
        traits = addUnique(traits, proposal.value);
        break;
      case 'recentDialogue':
        recentDialogues = addUnique(recentDialogues, proposal.value);
        break;
      case 'descriptionLine':
        description = addUnique(description, proposal.value);
        break;
      case 'voiceLine':
        voice = addUnique(voice, proposal.value);
        break;
      case 'desireLine':
        desire = addUnique(desire, proposal.value);
        break;
      default:
        break;
    }
  }

  return {
    ...card,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    ...(arc.length > 0 ? { arc } : {}),
    ...(traits.length > 0 ? { traits } : {}),
    ...(recentDialogues.length > 0 ? { recentDialogues } : {}),
    ...(description.length > 0 ? { description } : {}),
    ...(voice.length > 0 ? { voice } : {}),
    ...(desire.length > 0 ? { desire } : {}),
  };
}

function applyToBackground(
  card: BackgroundCard,
  accepted: readonly CardCollectProposal[],
): BackgroundCard {
  let description = [...(card.description ?? [])];
  let senses = [...(card.senses ?? [])];
  let characterIds = [...(card.characterIds ?? [])];
  let time = card.time;
  let weather = card.weather;

  for (const proposal of accepted) {
    if (proposal.kind === 'descriptionLine') {
      description = addUnique(description, proposal.value);
    } else if (proposal.kind === 'sense') {
      senses = addUnique(senses, proposal.value);
    } else if (proposal.kind === 'characterId') {
      characterIds = addUnique(characterIds, proposal.value);
    } else if (proposal.kind === 'scalar') {
      if (proposal.field === 'time') {
        time = proposal.after;
      } else {
        weather = proposal.after;
      }
    }
  }

  return {
    ...card,
    description,
    characterIds,
    ...(senses.length > 0 ? { senses } : {}),
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

// NOTE: Keyed fields are proposable when the key is absent (add) OR present with a different value
// (update). Free-form lists are append-only, so only genuinely new values qualify.
export function shouldProposeCardCollect(
  card: StoryboardCard,
  proposal: CardCollectProposal,
): boolean {
  if (card.type === 'character') {
    switch (proposal.kind) {
      case 'attribute': {
        const current = attributeValueAsString(card.attributes?.[proposal.key]);
        return current !== proposal.value;
      }
      case 'relation': {
        const current = (card.relations ?? []).find(
          (relation) => relation.target === proposal.target,
        );
        return current?.type !== proposal.type;
      }
      case 'arc': {
        const current = (card.arc ?? []).find((entry) => entry.sceneRef === proposal.sceneRef);
        return current?.summary !== proposal.summary;
      }
      case 'trait':
        return isNewListValue(card.traits, proposal.value);
      case 'recentDialogue':
        return isNewListValue(card.recentDialogues, proposal.value);
      case 'descriptionLine':
        return isNewListValue(card.description, proposal.value);
      case 'voiceLine':
        return isNewListValue(card.voice, proposal.value);
      case 'desireLine':
        return isNewListValue(card.desire, proposal.value);
      default:
        return false;
    }
  }

  switch (proposal.kind) {
    case 'descriptionLine':
      return isNewListValue(card.description, proposal.value);
    case 'sense':
      return isNewListValue(card.senses, proposal.value);
    case 'characterId':
      return isNewListValue(card.characterIds, proposal.value);
    case 'scalar':
      return (proposal.field === 'time' ? card.time : card.weather) !== proposal.after;
    default:
      return false;
  }
}
