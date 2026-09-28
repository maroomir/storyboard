import { promptResourceSources } from './resources.generated';
import { renderTemplate, type TemplatePartials, type TemplateView } from './template';
import type { PromptArtifact, PromptVariantId } from './types';

// A prompt resource is one Markdown file per prompt. `## system` and `## user` hold the generic
// variant; `## system:xs`, `## user:rich` and so on hold a variant's text, and a variant without
// its own section falls back to the generic one. The body of a section is the text up to the next
// `## ` heading with the trailing blank lines dropped.
export type PromptSectionName = 'system' | 'user';

export interface PromptResource {
  readonly key: string;
  readonly sections: ReadonlyMap<string, string>;
}

export class PromptResourceError extends Error {
  public constructor(
    public readonly code: 'missing-resource' | 'missing-section' | 'bad-heading',
    message: string,
  ) {
    super(message);
    this.name = 'PromptResourceError';
  }
}

const headingPattern = /^## (system|user)(?::(generic|xs|rich))?\s*$/;

export function parsePromptResource(key: string, text: string): PromptResource {
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

  for (const line of text.split('\n')) {
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

  return { key, sections };
}

// Where a prompt's text comes from. The bundled sources are the defaults; a host may lay the
// author's own files over them (workspace over home over bundle) before anything is rendered.
class PromptResourceStore {
  private readonly overrides = new Map<string, PromptResource>();
  private readonly bundled = new Map<string, PromptResource>();

  public get(key: string): PromptResource {
    const override = this.overrides.get(key);

    if (override !== undefined) {
      return override;
    }

    const cached = this.bundled.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const source = promptResourceSources[key];

    if (source === undefined) {
      throw new PromptResourceError('missing-resource', `프롬프트 리소스가 없습니다: ${key}`);
    }

    const parsed = parsePromptResource(key, source);
    this.bundled.set(key, parsed);

    return parsed;
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
