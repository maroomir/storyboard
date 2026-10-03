import {
  getStoryboardProjectPaths,
  type StoryboardProjectPaths,
  characterCardSchema,
  createEmptyBible,
  createEmptyCharacter,
  isIgnoredSampleCardFileName,
  joinStoryPath,
  locationBackgroundSchema,
  narratorCardSchema,
  parseCard,
  parseCardIdFromFileName,
  parseNarratorCard,
  readBibleFile,
  serializeCard,
  serializeNarratorCard,
  socialBackgroundSchema,
  temporalBackgroundSchema,
  writeBibleFile,
  type BibleFact,
  type StoryUri,
} from '@storyboard/story-model';
import { type IFileSystem } from '@storyboard/story-engine';
import { ZodError, type ZodType } from 'zod';

import type { BibleCard, BibleCardKind, BibleCardSummary, CanonFact } from '@/shared/dto';

import { fail, succeed, type ServiceResult } from './serviceResult';

function directoryOf(paths: StoryboardProjectPaths, kind: BibleCardKind): StoryUri {
  switch (kind) {
    case 'character':
      return paths.characterDirectory;
    case 'background':
      return paths.backgroundDirectory;
    case 'narrator':
      return paths.narratorDirectory;
  }
}

function schemaFor(kind: BibleCardKind, card: Record<string, unknown>): ZodType<BibleCard> {
  if (kind === 'character') {
    return characterCardSchema;
  }

  if (kind === 'narrator') {
    return narratorCardSchema;
  }

  if (card.type === 'temporal') {
    return temporalBackgroundSchema;
  }

  return card.type === 'social' ? socialBackgroundSchema : locationBackgroundSchema;
}

function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

function serialize(kind: BibleCardKind, card: BibleCard): string {
  return kind === 'narrator' && card.type === 'narrator'
    ? serializeNarratorCard(card)
    : serializeCard(card as Exclude<BibleCard, { type: 'narrator' }>);
}

function parse(kind: BibleCardKind, raw: string): BibleCard {
  return kind === 'narrator' ? parseNarratorCard(raw) : parseCard(raw);
}

function summaryDetail(card: BibleCard): string | undefined {
  switch (card.type) {
    case 'character':
      return card.role;
    case 'narrator':
      return card.person;
    default:
      return card.type;
  }
}

// The story bible screen: character, background and narrator cards, and the canon facts. Every
// write goes through the story-model schema and codec, so a card saved here serializes to the same
// bytes the extension and the CLI would write.
export class BibleService {
  private readonly paths: StoryboardProjectPaths;

  public constructor(
    private readonly fileSystem: IFileSystem,
    workspaceRoot: StoryUri,
    private readonly describeInvalidCard: (message: string) => string,
  ) {
    this.paths = getStoryboardProjectPaths(workspaceRoot);
  }

  public async list(kind: BibleCardKind): Promise<BibleCardSummary[]> {
    const directory = directoryOf(this.paths, kind);

    if (!(await this.fileSystem.exists(directory))) {
      return [];
    }

    const summaries: BibleCardSummary[] = [];

    for (const fileName of await this.fileSystem.listFileNames(directory)) {
      const id = parseCardIdFromFileName(fileName);

      if (id === undefined || isIgnoredSampleCardFileName(fileName)) {
        continue;
      }

      const card = await this.tryRead(kind, id);
      const detail = card === undefined ? undefined : summaryDetail(card);

      summaries.push({
        kind,
        id,
        name: card?.name ?? id,
        ...(detail === undefined ? {} : { detail }),
      });
    }

    return summaries.sort((left, right) => left.name.localeCompare(right.name));
  }

  public async read(kind: BibleCardKind, id: string): Promise<ServiceResult<BibleCard>> {
    const uri = this.cardUri(kind, id);

    if (!(await this.fileSystem.exists(uri))) {
      return fail('not-found', id);
    }

    try {
      return succeed(parse(kind, new TextDecoder().decode(await this.fileSystem.readFile(uri))));
    } catch (error) {
      return fail('invalid-request', this.describeInvalidCard(error instanceof Error ? error.message : String(error)));
    }
  }

  public async save(kind: BibleCardKind, input: Record<string, unknown>): Promise<ServiceResult<BibleCard>> {
    const parsed = schemaFor(kind, input).safeParse(input);

    if (!parsed.success) {
      return fail('invalid-request', this.describeInvalidCard(describeZodError(parsed.error)));
    }

    const card = parsed.data;
    const uri = this.cardUri(kind, card.id);

    // The id is the file name. Renaming rewrites references across the workspace, which is its own
    // command (`card rename`), so a save may only write a card that already exists under that id.
    if (!(await this.fileSystem.exists(uri))) {
      return fail('not-found', card.id);
    }

    await this.fileSystem.writeFile(uri, new TextEncoder().encode(serialize(kind, card)));
    return succeed(card);
  }

  public async create(kind: BibleCardKind, id: string, name: string): Promise<ServiceResult<BibleCard>> {
    const uri = this.cardUri(kind, id);

    if (await this.fileSystem.exists(uri)) {
      return fail('already-exists', id);
    }

    const card: BibleCard =
      kind === 'character'
        ? createEmptyCharacter(id, name)
        : kind === 'narrator'
          ? { type: 'narrator', id, name, person: 'third', knowledge: 'witnessed' }
          : {
              type: 'location',
              id,
              name,
              locationKind: 'place',
              description: [],
              characterIds: [],
              tags: [],
            };

    await this.fileSystem.createDirectory(directoryOf(this.paths, kind));
    await this.fileSystem.writeFile(uri, new TextEncoder().encode(serialize(kind, card)));
    return succeed(card);
  }

  public async remove(kind: BibleCardKind, id: string): Promise<ServiceResult<{ readonly name: string }>> {
    const uri = this.cardUri(kind, id);

    if (!(await this.fileSystem.exists(uri))) {
      return fail('not-found', id);
    }

    const name = (await this.tryRead(kind, id))?.name ?? id;
    await this.fileSystem.delete(uri);
    return succeed({ name });
  }

  public async listCanon(): Promise<CanonFact[]> {
    const facts = (await this.readCanon()).facts;
    const names = new Map<string, string>();

    for (const kind of ['character', 'background'] as const) {
      for (const summary of await this.list(kind)) {
        names.set(`${kind}:${summary.id}`, summary.name);
      }
    }

    return facts.map((fact) => {
      const subjectName = names.get(`${fact.subject.kind}:${fact.subject.id}`);
      return subjectName === undefined ? fact : { ...fact, subjectName };
    });
  }

  public async saveCanonFact(fact: BibleFact): Promise<CanonFact[]> {
    const bible = await this.readCanon();
    const others = bible.facts.filter((existing) => existing.id !== fact.id);
    const isNew = others.length === bible.facts.length;
    const facts = isNew
      ? [...bible.facts, fact]
      : bible.facts.map((existing) => (existing.id === fact.id ? fact : existing));

    await this.writeCanon({ ...bible, facts });
    return await this.listCanon();
  }

  public async deleteCanonFact(id: string): Promise<CanonFact[]> {
    const bible = await this.readCanon();

    await this.writeCanon({ ...bible, facts: bible.facts.filter((fact) => fact.id !== id) });
    return await this.listCanon();
  }

  private async readCanon(): Promise<ReturnType<typeof createEmptyBible>> {
    // A workspace starts without canon; the first confirmed fact creates the file.
    if (!(await this.fileSystem.exists(this.paths.bibleCanon))) {
      return createEmptyBible();
    }

    return await readBibleFile(this.paths.bibleCanon, this.fileSystem);
  }

  private async writeCanon(bible: ReturnType<typeof createEmptyBible>): Promise<void> {
    await this.fileSystem.createDirectory(this.paths.bibleDirectory);
    await writeBibleFile(this.paths.bibleCanon, this.fileSystem, bible);
  }

  private async tryRead(kind: BibleCardKind, id: string): Promise<BibleCard | undefined> {
    const result = await this.read(kind, id);
    return result.ok ? result.data : undefined;
  }

  private cardUri(kind: BibleCardKind, id: string): StoryUri {
    return joinStoryPath(directoryOf(this.paths, kind), `${id}.card`);
  }
}
