import { isElementKind, type ElementKind } from '@storyboard/story-model';

import type { SqlRow } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export interface IndexedElement {
  readonly id: string;
  readonly kind: ElementKind;
  readonly slug: string;
  readonly path: string;
  readonly cardHash: string;
}

function toIndexedElement(row: SqlRow): IndexedElement | undefined {
  const kind: string = String(row.kind);
  if (!isElementKind(kind)) {
    return undefined;
  }

  return {
    id: String(row.uuid),
    kind,
    slug: String(row.slug),
    path: String(row.path),
    cardHash: String(row.card_hash),
  };
}

function toIndexedElements(rows: readonly SqlRow[]): readonly IndexedElement[] {
  return rows.flatMap((row): IndexedElement[] => {
    const element: IndexedElement | undefined = toIndexedElement(row);
    return element === undefined ? [] : [element];
  });
}

export class ElementIndexStore {
  public constructor(private readonly database: CacheDatabase) {}

  public list(kind?: ElementKind): readonly IndexedElement[] {
    return kind === undefined
      ? toIndexedElements(this.database.all('SELECT * FROM element_index ORDER BY path'))
      : toIndexedElements(
          this.database.all('SELECT * FROM element_index WHERE kind = ? ORDER BY path', [kind]),
        );
  }

  public findByPath(path: string): IndexedElement | undefined {
    const row: SqlRow | undefined = this.database.first(
      'SELECT * FROM element_index WHERE path = ?',
      [path],
    );
    return row === undefined ? undefined : toIndexedElement(row);
  }

  public findById(id: string): readonly IndexedElement[] {
    return toIndexedElements(
      this.database.all('SELECT * FROM element_index WHERE uuid = ? ORDER BY path', [id]),
    );
  }

  public upsert(element: IndexedElement): void {
    const current: IndexedElement | undefined = this.findByPath(element.path);
    const isUnchanged: boolean =
      current !== undefined &&
      current.id === element.id &&
      current.kind === element.kind &&
      current.slug === element.slug &&
      current.cardHash === element.cardHash;
    if (isUnchanged) {
      return;
    }

    this.database.run(
      'INSERT OR REPLACE INTO element_index (path, uuid, kind, slug, card_hash) VALUES (?, ?, ?, ?, ?)',
      [element.path, element.id, element.kind, element.slug, element.cardHash],
    );
  }

  public remove(path: string): void {
    this.database.run('DELETE FROM element_index WHERE path = ?', [path]);
  }

  public replaceAll(elements: readonly IndexedElement[]): void {
    this.database.transaction((): void => {
      this.database.run('DELETE FROM element_index');
      elements.forEach((element) => this.upsert(element));
    });
  }
}
