import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { aiProviderIds } from '@storyboard/story-ai';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { configSchema } from '../src/config/config';

// Shipped as a JSON Schema so an operator editing the config file gets completion and validation
// in their editor. The bot's zod schema is the single source of truth; regenerate the file with
// `npm run schema:emit` from this workspace.
const SCHEMA_FILE = fileURLToPath(new URL('../assets/config.schema.json', import.meta.url));

function buildSchema(): unknown {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'storyboard-bot config',
    ...z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any', target: 'draft-7' }),
  };
}

function serialize(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

describe('storyboard-bot config JSON Schema', () => {
  it('matches the schema file this app ships', () => {
    const generated = serialize(buildSchema());

    if (process.env.UPDATE_CONFIG_SCHEMA === '1') {
      writeFileSync(SCHEMA_FILE, generated, 'utf8');
    }

    expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(generated);
  });

  it('requires the two keys that block boot and lists every engine provider', () => {
    const schema = buildSchema() as {
      required?: string[];
      properties: { providers: { properties: { default: { enum?: string[] } } } };
    };

    expect(schema.required).toEqual(['telegram', 'workspace']);
    expect(schema.properties.providers.properties.default.enum).toEqual([...aiProviderIds]);
  });
});
