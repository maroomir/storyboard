import { z } from 'zod';

import { cacheTtls, reasoningEfforts } from '@storyboard/story-model';

import { promptResourceSources } from './resources.generated';
import { renderTemplate, type TemplatePartials, type TemplateView } from './template';
import type { PromptArtifact, PromptConfig, PromptVariantId } from './types';

export type PromptSectionName = 'system' | 'prefix' | 'user';

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

const headingPattern: RegExp = /^## (system|prefix|user)(?::(generic|xs|rich))?\s*$/;

const promptConfigSchema: z.ZodType<PromptConfig> = z.strictObject({
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  reasoningEffort: z.enum(reasoningEfforts).optional(),
  prefixCacheTtl: z.enum(cacheTtls).optional(),
});

const frontMatterLinePattern: RegExp = /^([A-Za-z]+):\s*(\S+)\s*$/;
const numberPattern: RegExp = /^-?\d+(?:\.\d+)?$/;

function parseFrontMatter(
  key: string,
  lines: readonly string[],
): { readonly config: PromptConfig | undefined; readonly bodyStart: number } {
  if (lines[0] !== '---') {
    return { config: undefined, bodyStart: 0 };
  }

  const end: number = lines.indexOf('---', 1);

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

    const match: RegExpExecArray | null = frontMatterLinePattern.exec(line);

    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new PromptResourceError(
        'bad-front-matter',
        `프롬프트 리소스 ${key}의 머리말을 이해할 수 없습니다: ${line}`,
      );
    }

    fields[match[1]] = numberPattern.test(match[2]) ? Number(match[2]) : match[2];
  }

  const parsed: z.ZodSafeParseResult<PromptConfig> = promptConfigSchema.safeParse(fields);

  if (!parsed.success) {
    const issue: z.core.$ZodIssue | undefined = parsed.error.issues[0];
    throw new PromptResourceError(
      'bad-front-matter',
      `프롬프트 리소스 ${key}의 머리말이 잘못되었습니다: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
    );
  }

  return { config: parsed.data, bodyStart: end + 1 };
}

export function parsePromptResource(key: string, text: string): PromptResource {
  const lines: string[] = text.split('\n');
  const { config, bodyStart } = parseFrontMatter(key, lines);
  const sections: Map<string, string> = new Map<string, string>();
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
      const match: RegExpExecArray | null = headingPattern.exec(line);

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

class PromptResourceStore {
  private readonly overrides: Map<string, PromptResource> = new Map<string, PromptResource>();
  private readonly bundledCache: Map<string, PromptResource> = new Map<string, PromptResource>();

  public get(key: string): PromptResource {
    return this.overrides.get(key) ?? this.bundled(key);
  }

  private bundled(key: string): PromptResource {
    const cached: PromptResource | undefined = this.bundledCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const source: string | undefined = promptResourceSources[key];

    if (source === undefined) {
      throw new PromptResourceError('missing-resource', `프롬프트 리소스가 없습니다: ${key}`);
    }

    const parsed: PromptResource = parsePromptResource(key, source);
    this.bundledCache.set(key, parsed);

    return parsed;
  }

  public config(key: string): PromptConfig {
    return this.overrides.get(key)?.config ?? this.bundledConfig(key);
  }

  public bundledConfig(key: string): PromptConfig {
    const config: PromptConfig | undefined = this.bundled(key).config;

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

export const promptResources: PromptResourceStore = new PromptResourceStore();

export function promptResourceFingerprint(key: string): string {
  const resource: PromptResource = promptResources.get(key);

  return JSON.stringify({ config: resource.config ?? null, sections: [...resource.sections] });
}

export function promptResourceKeys(): readonly string[] {
  return Object.keys(promptResourceSources);
}

function optionalSectionText(
  resource: PromptResource,
  name: PromptSectionName,
  variant: PromptVariantId,
): string | undefined {
  return resource.sections.get(`${name}:${variant}`) ?? resource.sections.get(name);
}

function sectionText(
  resource: PromptResource,
  name: PromptSectionName,
  variant: PromptVariantId,
): string {
  const text: string | undefined = optionalSectionText(resource, name, variant);

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

export function renderPrompt(
  key: string,
  variant: PromptVariantId,
  options: RenderPromptOptions,
): PromptArtifact {
  const resource: PromptResource = promptResources.get(key);
  const partials: TemplatePartials = options.partials ?? {};
  const prefix: string | undefined = optionalSectionText(resource, 'prefix', variant);
  const prefixCacheTtl: "5m" | "1h" | undefined = prefix === undefined ? undefined : promptResources.config(key).prefixCacheTtl;

  return {
    system: renderTemplate(sectionText(resource, 'system', variant), options.view, partials),
    ...(prefix === undefined ? {} : { userPrefix: renderTemplate(prefix, options.view, partials) }),
    ...(prefixCacheTtl === undefined ? {} : { prefixCacheTtl }),
    user: renderTemplate(sectionText(resource, 'user', variant), options.view, partials),
  };
}
