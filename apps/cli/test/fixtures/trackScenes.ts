import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TrackSceneFixture {
  readonly stem: string;
  readonly title: string;
  readonly targetWordCount?: number;
  readonly purpose?: string;
}

export function writeTrackScene(genreRoot: string, scene: TrackSceneFixture): void {
  const bundle: string = join(genreRoot, 'scene', `${scene.stem}.card`);
  const slug: string = scene.stem.replace(/^\d{3}-/u, '');
  const targetLine: string =
    scene.targetWordCount === undefined ? '' : `targetWordCount: ${scene.targetWordCount}\n`;
  const statements: string =
    scene.purpose === undefined
      ? '[]\n'
      : `- {facet: purpose, value: ${scene.purpose}, source: {origin: author}}\n`;

  mkdirSync(bundle, { recursive: true });
  writeFileSync(
    join(bundle, 'card.yaml'),
    `id: ${randomUUID()}\nslug: ${slug}\nkind: scene\ntitle: ${scene.title}\n${targetLine}`,
  );
  writeFileSync(join(bundle, 'statements.yaml'), statements);
  writeFileSync(join(bundle, 'beats.yaml'), '- text: 문을 연다.\n');
}
