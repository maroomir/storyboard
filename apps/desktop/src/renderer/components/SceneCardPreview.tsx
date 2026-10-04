import type { SceneNotes } from '@/shared/dto';

import { useI18n } from '@/renderer/lib/i18n';

export function SceneCardPreview(props: { readonly notes: SceneNotes }): JSX.Element | null {
  const { t } = useI18n();
  const { notes } = props;
  const characterNames = notes.characters.map((card) => card.name);
  const hasContent =
    notes.summary !== undefined ||
    notes.beats.length > 0 ||
    characterNames.length > 0 ||
    notes.background !== undefined ||
    notes.mood !== undefined;

  if (!hasContent) {
    return null;
  }

  return (
    <details className="scene-card-preview">
      <summary>{t('desk.sceneCard', { count: notes.beats.length })}</summary>
      {notes.summary === undefined ? null : (
        <section>
          <h3>{t('desk.sceneCardSummary')}</h3>
          <p className="scene-card-summary">{notes.summary}</p>
        </section>
      )}
      {notes.beats.length === 0 ? null : (
        <section>
          <h3>{t('desk.sceneCardBeats')}</h3>
          <ol>
            {notes.beats.map((beat, index) => (
              <li key={`${index}-${beat}`}>{beat}</li>
            ))}
          </ol>
        </section>
      )}
      <dl>
        {characterNames.length === 0 ? null : (
          <>
            <dt>{t('desk.sceneCardCharacters')}</dt>
            <dd>{characterNames.join(', ')}</dd>
          </>
        )}
        {notes.background === undefined ? null : (
          <>
            <dt>{t('desk.sceneCardLocation')}</dt>
            <dd>{notes.background.name}</dd>
          </>
        )}
        {notes.mood === undefined ? null : (
          <>
            <dt>{t('desk.sceneCardMood')}</dt>
            <dd>{notes.mood}</dd>
          </>
        )}
      </dl>
    </details>
  );
}
