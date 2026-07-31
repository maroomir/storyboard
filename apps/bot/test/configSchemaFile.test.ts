import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { configSchema } from '../src/config/config';

// The extension contributes this file as a JSON Schema so an operator editing
// ~/.storygram/config.json gets completion and validation in the editor. The bot's zod schema is
// the single source of truth, but the file has to live inside apps/desktop because only that
// directory is packaged into the VSIX. Regenerate with `npm run schema:emit --workspace storygram`.
const SCHEMA_FILE = fileURLToPath(
  new URL('../../desktop/assets/storygram-config.schema.json', import.meta.url),
);

function buildSchema(): unknown {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'storygram config',
    ...z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any', target: 'draft-7' }),
  };
}

function serialize(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

describe('storygram config JSON Schema', () => {
  it('matches the schema file the extension ships', () => {
    const generated = serialize(buildSchema());

    if (process.env.UPDATE_CONFIG_SCHEMA === '1') {
      writeFileSync(SCHEMA_FILE, generated, 'utf8');
    }

    expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(generated);
  });

  it('requires the two keys that block boot and knows the CLI-only providers', () => {
    const schema = buildSchema() as {
      required?: string[];
      properties: { providers: { properties: { default: { enum?: string[] } } } };
    };

    expect(schema.required).toEqual(['telegram', 'workspace']);
    expect(schema.properties.providers.properties.default.enum).toEqual([
      'mock',
      'claude-code',
      'codex',
    ]);
  });
});
