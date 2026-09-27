import type { SceneNotes } from '@/shared/dto';

import { useI18n } from '@/renderer/lib/i18n';
import { describeNarration } from '@/renderer/lib/narrativeLabels';

export function MarginNotes(props: { readonly notes: SceneNotes | undefined }): JSX.Element {
  const { t, language } = useI18n();
  const { notes } = props;

  if (notes === undefined) {
    return <aside className="notes" aria-busy="true" />;
  }

  return (
    <aside className="notes" aria-label={notes.title}>
      {notes.narration === undefined ? null : (
        <section>
          <h3>{t('notes.narration')}</h3>
          <div className="note">
            {describeNarration(language, t, notes.narration)}
            <span className="note-meta">{t('notes.thread', { thread: notes.thread })}</span>
          </div>
        </section>
      )}
      <section>
        <h3>{t('notes.cards')}</h3>
        {notes.characters.length === 0 && notes.background === undefined ? <p>{t('bible.empty')}</p> : null}
        {notes.characters.map((card) => (
          <div key={card.id} className="note">
            {card.name}
            {card.summary === undefined ? null : <span className="note-meta">{card.summary}</span>}
          </div>
        ))}
        {notes.background === undefined ? null : (
          <div className="note">
            {notes.background.name}
            <span className="note-meta">
              {t('notes.background')}
              {notes.background.summary === undefined ? '' : ` · ${notes.background.summary}`}
            </span>
          </div>
        )}
      </section>
      <section>
        <h3>{t('notes.facts')}</h3>
        {notes.facts.length === 0 ? <p>{t('notes.noFacts')}</p> : null}
        {notes.facts.map((fact, index) => (
          <div key={`${fact.text}-${index}`} className="note">
            {fact.text}
            {fact.witnesses.length === 0 ? null : (
              <span className="note-meta">{t('notes.witnesses', { names: fact.witnesses.join(', ') })}</span>
            )}
          </div>
        ))}
      </section>
      {notes.review === undefined && notes.warnings.length === 0 ? null : (
        <section>
          <h3>{notes.review === undefined ? t('notes.warnings') : t('notes.review')}</h3>
          {notes.review === undefined ? null : (
            <div className="note">
              {t('notes.revisions', { count: notes.review.revisionCount })} ·{' '}
              {t('notes.blocking', { count: notes.review.remainingBlocking })}
              {notes.review.instructions.map((instruction) => (
                <span key={instruction} className="note-meta">
                  {instruction}
                </span>
              ))}
            </div>
          )}
          {notes.warnings.map((warning) => (
            <div key={warning} className="note">
              {warning}
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
