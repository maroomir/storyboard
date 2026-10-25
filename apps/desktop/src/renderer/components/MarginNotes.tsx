import type { SceneNotes } from '@/shared/dto';

import { useI18n } from '@/renderer/lib/i18n';
import { describeNarration } from '@/renderer/lib/narrativeLabels';

export function MarginNotes(props: { readonly notes: SceneNotes | undefined }): JSX.Element {
  const { translate, language } = useI18n();
  const { notes } = props;

  if (notes === undefined) {
    return <aside className="notes" aria-busy="true" />;
  }

  return (
    <aside className="notes" aria-label={notes.title}>
      {notes.narration === undefined ? null : (
        <section>
          <h3>{translate('notes.narration')}</h3>
          <div className="note">
            {describeNarration(language, translate, notes.narration)}
            <span className="note-meta">{translate('notes.thread', { thread: notes.thread })}</span>
          </div>
        </section>
      )}
      <section>
        <h3>{translate('notes.cards')}</h3>
        {notes.characters.length === 0 && notes.background === undefined ? <p>{translate('bible.empty')}</p> : null}
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
              {translate('notes.background')}
              {notes.background.summary === undefined ? '' : ` · ${notes.background.summary}`}
            </span>
          </div>
        )}
      </section>
      <section>
        <h3>{translate('notes.facts')}</h3>
        {notes.facts.length === 0 ? <p>{translate('notes.noFacts')}</p> : null}
        {notes.facts.map((fact, index) => (
          <div key={`${fact.text}-${index}`} className="note">
            {fact.text}
            {fact.witnesses.length === 0 ? null : (
              <span className="note-meta">{translate('notes.witnesses', { names: fact.witnesses.join(', ') })}</span>
            )}
          </div>
        ))}
      </section>
      {notes.review === undefined && notes.warnings.length === 0 ? null : (
        <section>
          <h3>{notes.review === undefined ? translate('notes.warnings') : translate('notes.review')}</h3>
          {notes.review === undefined ? null : (
            <div className="note">
              {translate('notes.revisions', { count: notes.review.revisionCount })} ·{' '}
              {translate('notes.blocking', { count: notes.review.remainingBlocking })}
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
