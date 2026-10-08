import { z } from 'zod';

import { reasoningEfforts } from '@storyboard/story-model';

import { promptResourceSources } from './resources.generated';
import { renderTemplate, type TemplatePartials, type TemplateView } from './template';
import type { PromptArtifact, PromptConfig, PromptVariantId } from './types';

// A prompt resource is one Markdown file per prompt. A front-matter block between `---` lines
// carries the sampling config (`temperature`, `maxTokens`, optionally `reasoningEffort`); `## system` and `## user` hold the
// generic variant; `## system:xs`, `## user:rich` and so on hold a variant's text, and a variant
// without its own section falls back to the generic one. The body of a section is the text up to
// the next `## ` heading with the trailing blank lines dropped.
export type PromptSectionName = 'system' | 'user';

export interface PromptResource {
  readonly key: string;
  readonly config: PromptConfig | undefined;
  readonly sections: ReadonlyMap<string, string>;
}

export class PromptResourceError extends Error {
  public constructor(
    public readonly code:
      | 'missing-resource'
      | 'missing-section'
      | 'missing-config'
      | 'bad-heading'
      | 'bad-front-matter',
    message: string,
  ) {
    super(message);
    this.name = 'PromptResourceError';
  }
}

const headingPattern = /^## (system|user)(?::(generic|xs|rich))?\s*$/;

// 온도는 검사류를 낮게, 창작류를 높게 두는 결이 있어 프롬프트마다 다르고, 출력 상한은 한 번에
// 낼 분량이다. 모델을 가리지 않는 값이며, 한 모델에서만 관찰한 값은 modelProfiles.params.json 에 적는다.
const promptConfigSchema = z.strictObject({
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  reasoningEffort: z.enum(reasoningEfforts).optional(),
});

const frontMatterLinePattern = /^([A-Za-z]+):\s*(\S+)\s*$/;
const numberPattern = /^-?\d+(?:\.\d+)?$/;

function parseFrontMatter(
  key: string,
  lines: readonly string[],
): { readonly config: PromptConfig | undefined; readonly bodyStart: number } {
  if (lines[0] !== '---') {
    return { config: undefined, bodyStart: 0 };
  }

  const end = lines.indexOf('---', 1);

  if (end === -1) {
    throw new PromptResourceError(
      'bad-front-matter',
      `프롬프트 리소스 ${key}의 머리말(---)이 닫히지 않았습니다.`,
    );
  }

  const fields: Record<string, number | string> = {};

  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') {
      continue;
    }

    const match = frontMatterLinePattern.exec(line);

    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new PromptResourceError(
        'bad-front-matter',
        `프롬프트 리소스 ${key}의 머리말을 이해할 수 없습니다: ${line}`,
      );
    }

    fields[match[1]] = numberPattern.test(match[2]) ? Number(match[2]) : match[2];
  }

  const parsed = promptConfigSchema.safeParse(fields);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PromptResourceError(
      'bad-front-matter',
      `프롬프트 리소스 ${key}의 머리말이 잘못되었습니다: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
    );
  }

  return { config: parsed.data, bodyStart: end + 1 };
}

export function parsePromptResource(key: string, text: string): PromptResource {
  const lines = text.split('\n');
  const { config, bodyStart } = parseFrontMatter(key, lines);
  const sections = new Map<string, string>();
  let currentName: string | undefined;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (currentName === undefined) {
      return;
    }

    while (currentLines.length > 0 && currentLines[currentLines.length - 1]?.trim() === '') {
      currentLines.pop();
    }

    sections.set(currentName, currentLines.join('\n'));
  };

  for (const line of lines.slice(bodyStart)) {
    if (line.startsWith('## ')) {
      const match = headingPattern.exec(line);

      if (match === null) {
        throw new PromptResourceError(
          'bad-heading',
          `프롬프트 리소스 ${key}의 제목을 이해할 수 없습니다: ${line}`,
        );
      }

      flush();
      currentName =
        match[2] === undefined || match[2] === 'generic' ? match[1] : `${match[1]}:${match[2]}`;
      currentLines = [];
      continue;
    }

    if (currentName !== undefined) {
      currentLines.push(line);
    }
  }

  flush();

  return { key, config, sections };
}

// Where a prompt's text comes from. The bundled sources are the defaults; a host may lay the
// author's own files over them (workspace over home over bundle) before anything is rendered.
class PromptResourceStore {
  private readonly overrides = new Map<string, PromptResource>();
  private readonly bundledCache = new Map<string, PromptResource>();

  public get(key: string): PromptResource {
    return this.overrides.get(key) ?? this.bundled(key);
  }

  private bundled(key: string): PromptResource {
    const cached = this.bundledCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const source = promptResourceSources[key];

    if (source === undefined) {
      throw new PromptResourceError('missing-resource', `프롬프트 리소스가 없습니다: ${key}`);
    }

    const parsed = parsePromptResource(key, source);
    this.bundledCache.set(key, parsed);

    return parsed;
  }

  // An author's file may leave the front-matter out and keep the bundled sampling config.
  public config(key: string): PromptConfig {
    return this.overrides.get(key)?.config ?? this.bundledConfig(key);
  }

  public bundledConfig(key: string): PromptConfig {
    const config = this.bundled(key).config;

    if (config === undefined) {
      throw new PromptResourceError(
        'missing-config',
        `프롬프트 리소스 ${key}에 temperature·maxTokens 머리말이 없습니다.`,
      );
    }

    return config;
  }

  public override(key: string, text: string): void {
    this.overrides.set(key, parsePromptResource(key, text));
  }

  public clearOverrides(): void {
    this.overrides.clear();
  }

  public overriddenKeys(): readonly string[] {
    return [...this.overrides.keys()];
  }
}

export const promptResources = new PromptResourceStore();

// The text in force for a prompt, bundled or the author's, as one stable string. A cache of what the
// prompt produced keys on it so a reworded prompt does not keep serving the old wording's output.
export function promptResourceFingerprint(key: string): string {
  const resource = promptResources.get(key);

  return JSON.stringify({ config: resource.config ?? null, sections: [...resource.sections] });
}

export function promptResourceKeys(): readonly string[] {
  return Object.keys(promptResourceSources);
}

function sectionText(
  resource: PromptResource,
  name: PromptSectionName,
  variant: PromptVariantId,
): string {
  const text = resource.sections.get(`${name}:${variant}`) ?? resource.sections.get(name);

  if (text === undefined) {
    throw new PromptResourceError(
      'missing-section',
      `프롬프트 리소스 ${resource.key}에 ${name} 섹션이 없습니다.`,
    );
  }

  return text;
}

export interface RenderPromptOptions {
  readonly view: TemplateView;
  readonly partials?: TemplatePartials;
}

// Renders a prompt's system and user text for a variant from its resource and the module's view.
export function renderPrompt(
  key: string,
  variant: PromptVariantId,
  options: RenderPromptOptions,
): PromptArtifact {
  const resource = promptResources.get(key);
  const partials = options.partials ?? {};

  return {
    system: renderTemplate(sectionText(resource, 'system', variant), options.view, partials),
    user: renderTemplate(sectionText(resource, 'user', variant), options.view, partials),
  };
}
