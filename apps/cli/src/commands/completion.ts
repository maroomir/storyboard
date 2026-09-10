import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  aiProviderIds,
  isCliProvider,
  storyboardModelCatalog,
  storyboardSettingCatalog,
} from '@storyboard/story-ai';
import {
  compositionKindLabels,
  compositionKinds,
  isIgnoredSampleCardFileName,
  narrativeTenseLabels,
  narrativeTenses,
  narratorKnowledgeLabels,
  narratorKnowledges,
  narratorPersonLabels,
  narratorPersons,
  pointOfViewLabels,
  pointOfViews,
} from '@storyboard/story-format';

import {
  commandCatalog,
  completionShells,
  findCommandSpec,
  findFlagSpec,
  globalFlagNames,
  initLanguages,
  type CommandSpec,
} from './catalog';
export { completionShells, type CompletionShell } from './catalog';

export interface Completion {
  readonly text: string;
  readonly description: string;
}

export interface CompletionContext {
  readonly cwd: string;
}


function unique(items: readonly Completion[]): Completion[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.text) ? false : (seen.add(item.text), true)));
}

function listFiles(directory: string, extension: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((name) => name.endsWith(extension) && !isIgnoredSampleCardFileName(name))
    .map((name) => name.slice(0, -extension.length))
    .sort();
}

function workspaceRoot(words: readonly string[], cwd: string): string {
  const index = words.indexOf('--workspace');
  const flagged = index >= 0 ? words[index + 1] : undefined;
  const inline = words
    .find((word) => word.startsWith('--workspace='))
    ?.slice('--workspace='.length);
  return resolve(cwd, flagged ?? inline ?? '.');
}

function describeVerbWord(prefixWords: readonly string[]): Completion[] {
  const depth = prefixWords.length;
  const prefix = prefixWords.join(' ');
  const nextWords = new Map<string, Completion>();

  for (const spec of commandCatalog) {
    if (spec.verb === 'tui' && depth === 0) {
      continue;
    }
    const parts = spec.verb.split(' ');
    if (parts.length <= depth || (depth > 0 && parts.slice(0, depth).join(' ') !== prefix)) {
      continue;
    }
    const word = parts[depth] ?? '';
    const isLeaf = parts.length === depth + 1;
    if (!nextWords.has(word) || isLeaf) {
      nextWords.set(word, { text: word, description: isLeaf ? spec.summary : `${word} …` });
    }
  }

  return [...nextWords.values()];
}

function flagCompletions(spec: CommandSpec | undefined): Completion[] {
  const names = [...(spec?.flags ?? []), ...globalFlagNames.filter((name) => name !== 'version')];
  return unique(
    names.map((name) => {
      const flag = findFlagSpec(name);
      return { text: `--${name}`, description: flag?.summary ?? '' };
    }),
  );
}

function valueCompletions(flagName: string, words: readonly string[]): Completion[] | undefined {
  switch (flagName) {
    case 'provider':
    case 'fallback':
      return aiProviderIds.map((id) => ({ text: id, description: '' }));
    case 'model': {
      const providerIndex = words.indexOf('--provider');
      const provider = providerIndex >= 0 ? words[providerIndex + 1] : undefined;
      const catalog =
        provider && provider in storyboardModelCatalog
          ? storyboardModelCatalog[provider as keyof typeof storyboardModelCatalog]
          : undefined;
      return (catalog ?? []).map((entry) => ({ text: entry.id, description: entry.displayName }));
    }
    case 'key':
      return configKeyCompletions();
    case 'pov':
      return pointOfViews.map((value) => ({ text: value, description: pointOfViewLabels[value] }));
    case 'composition':
      return compositionKinds.map((value) => ({
        text: value,
        description: compositionKindLabels[value],
      }));
    case 'person':
      return narratorPersons.map((value) => ({
        text: value,
        description: narratorPersonLabels[value],
      }));
    case 'knowledge':
      return narratorKnowledges.map((value) => ({
        text: value,
        description: narratorKnowledgeLabels[value],
      }));
    case 'tense':
      return narrativeTenses.map((value) => ({
        text: value,
        description: narrativeTenseLabels[value],
      }));
    case 'language':
      return initLanguages.map((code) => ({ text: code, description: '' }));
    case 'workspace':
      // Directories are the shell's own business; returning nothing lets it fall back to paths.
      return [];
    default:
      return findFlagSpec(flagName)?.valueLabel === undefined ? undefined : [];
  }
}

function configKeyCompletions(): Completion[] {
  const providerKeys = aiProviderIds.flatMap((id) => [
    { text: `providers.${id}.model`, description: `${id} 모델` },
    ...(isCliProvider(id)
      ? [{ text: `providers.${id}.command`, description: `${id} 실행 명령` }]
      : []),
    ...(id === 'ollama'
      ? [{ text: 'providers.ollama.baseUrl', description: 'Ollama Base URL' }]
      : []),
  ]);

  return [
    { text: 'defaultProvider', description: '기본 AI 프로바이더' },
    ...providerKeys,
    ...storyboardSettingCatalog.map((entry) => ({ text: entry.key, description: entry.label })),
  ];
}

// Positional slots come from the catalog's usage line: `<stem>` is a scene, `<id>` after
// `card rename <kind>` is a card of that kind, and so on.
function positionalCompletions(
  spec: CommandSpec,
  positionalIndex: number,
  words: readonly string[],
  context: CompletionContext,
): Completion[] {
  const slots = spec.usage
    .split(' ')
    .slice(spec.verb.split(' ').length)
    .filter((token) => token.startsWith('<'));
  const slot = slots[positionalIndex];
  const root = workspaceRoot(words, context.cwd);

  switch (slot) {
    case '<stem>':
      return listFiles(join(root, 'scene'), '.card').map((stem) => ({
        text: stem,
        description: '씬',
      }));
    case '<id>': {
      if (spec.verb.startsWith('narrator ')) {
        return listFiles(join(root, 'narrator'), '.card').map((id) => ({
          text: id,
          description: '서술자',
        }));
      }

      const kind = spec.verb.endsWith('character') ? 'character' : 'background';
      return listFiles(join(root, kind), '.card').map((id) => ({
        text: id,
        description: kind === 'character' ? '인물' : '배경',
      }));
    }
    case '<provider>':
      return aiProviderIds.map((id) => ({ text: id, description: '' }));
    case '<key>':
      return configKeyCompletions();
    case '<command>':
      return commandCatalog
        .filter((entry) => entry.verb !== 'tui')
        .map((entry) => ({ text: entry.verb, description: entry.summary }));
    case '<zsh|bash|fish>':
      return completionShells.map((shell) => ({
        text: shell,
        description: `${shell} 완성 스크립트`,
      }));
    default:
      return [];
  }
}

// `words` is everything after `storyboard` up to and including the word being typed (possibly
// empty). The answer is what could legally come next, filtered by that last word.
export function computeCompletions(
  words: readonly string[],
  context: CompletionContext,
): Completion[] {
  const current = words[words.length - 1] ?? '';
  const previous = words.slice(0, -1);

  const previousWord = previous[previous.length - 1];
  if (previousWord?.startsWith('--') && !previousWord.includes('=')) {
    const values = valueCompletions(previousWord.slice(2), previous);
    if (values !== undefined) {
      return filterByPrefix(values, current);
    }
  }

  const verbWords: string[] = [];
  const positionals: string[] = [];
  let skipValue = false;

  for (const word of previous) {
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (word.startsWith('--')) {
      const name = word.slice(2).split('=')[0] ?? '';
      skipValue = findFlagSpec(name)?.valueLabel !== undefined && !word.includes('=');
      continue;
    }
    const candidate = [...verbWords, word].join(' ');
    if (
      commandCatalog.some(
        (spec) => spec.verb === candidate || spec.verb.startsWith(`${candidate} `),
      )
    ) {
      verbWords.push(word);
    } else {
      positionals.push(word);
    }
  }

  const verb = verbWords.join(' ');
  const spec = findCommandSpec(verb);

  if (current.startsWith('-')) {
    return filterByPrefix(flagCompletions(spec), current);
  }

  const candidates: Completion[] = [];

  if (spec === undefined || spec.usage === spec.verb || positionals.length === 0) {
    candidates.push(...describeVerbWord(verbWords));
  }

  if (spec !== undefined) {
    candidates.push(...positionalCompletions(spec, positionals.length, previous, context));
  }

  return filterByPrefix(unique(candidates), current);
}

function filterByPrefix(items: readonly Completion[], prefix: string): Completion[] {
  return items.filter((item) => item.text.startsWith(prefix));
}

export function formatCompletions(items: readonly Completion[]): string {
  return items
    .map((item) => (item.description ? `${item.text}\t${item.description}` : item.text))
    .join('\n');
}

const zshScript = `#compdef storyboard
# Storyboard CLI completion for zsh. Register with: eval "$(storyboard completion zsh)"
_storyboard() {
  local -a lines entries
  lines=("\${(@f)$(storyboard __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  for line in "\${lines[@]}"; do
    [[ -z "$line" ]] && continue
    entries+=("\${line%%$'\\t'*}:\${line#*$'\\t'}")
  done
  if (( \${#entries} )); then
    _describe 'storyboard' entries
  else
    _files
  fi
}
compdef _storyboard storyboard
`;

const bashScript = `# Storyboard CLI completion for bash. Register with: eval "$(storyboard completion bash)"
_storyboard() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local candidates
  candidates="$(storyboard __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null | cut -f1)"
  if [ -n "$candidates" ]; then
    COMPREPLY=($(compgen -W "$candidates" -- "$cur"))
  else
    COMPREPLY=($(compgen -f -- "$cur"))
  fi
}
complete -F _storyboard storyboard
`;

const fishScript = `# Storyboard CLI completion for fish. Register with: storyboard completion fish | source
function __storyboard_complete
  set -l tokens (commandline -opc)
  storyboard __complete $tokens[2..] (commandline -ct) 2>/dev/null
end
complete -c storyboard -f -a '(__storyboard_complete)'
`;

export function renderCompletionScript(shell: string): string | undefined {
  switch (shell) {
    case 'zsh':
      return zshScript;
    case 'bash':
      return bashScript;
    case 'fish':
      return fishScript;
    default:
      return undefined;
  }
}
