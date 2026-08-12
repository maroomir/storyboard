import { z } from 'zod';

import { parseCard, type StoryboardCard } from '@seedkernel/wasm';

// NOTE: The validation rules live in the wasm engine, so this stays a thin zod adapter: message
// contracts can keep composing `card: cardSchema` while the engine remains the single source of
// truth for what a valid card is.
export const cardSchema = z.custom<StoryboardCard>(
  (value) => {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    try {
      parseCard(JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Card 스키마가 올바르지 않습니다.' },
);
