import type { StoryUri } from '@storyboard/story-model';

export type SqlValue = string | number | null;

export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface ISqlDatabase {
  execute(sql: string): void;
  run(sql: string, parameters?: readonly SqlValue[]): void;
  all(sql: string, parameters?: readonly SqlValue[]): readonly SqlRow[];
  close(): void;
}

export interface ISqlDatabaseHost {
  open(uri: StoryUri): Promise<ISqlDatabase>;
}
