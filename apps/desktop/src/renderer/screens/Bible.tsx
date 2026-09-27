import { useEffect, useState } from 'react';

import {
  characterRoles,
  narrativeTenses,
  narratorKnowledges,
  narratorPersons,
  type BackgroundCard,
  type CharacterCard,
  type NarratorCard,
} from '@storyboard/story-format/contracts';

import type { BibleCard, BibleCardKind, BibleCardSummary, CanonFact, RunSnapshot } from '@/shared/dto';

import type { WorkspaceChange } from '@/renderer/lib/workspaceChange';
import { call, messageOf } from '@/renderer/lib/call';
import { useI18n, type Translate } from '@/renderer/lib/i18n';
import { knowledgeLabel, personLabel, tenseLabel } from '@/renderer/lib/narrativeLabels';

type BibleTab = BibleCardKind | 'canon';

const tabs: readonly BibleTab[] = ['character', 'background', 'narrator', 'canon'];

interface BibleProps {
  readonly run: RunSnapshot | undefined;
  readonly change: WorkspaceChange;
  readonly onError: (message: string) => void;
}

export function Bible(props: BibleProps): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<BibleTab>('character');
  const isReadOnly = props.run !== undefined && props.run.status !== 'idle';

  return (
    <main className="workspace-page">
      <div className="workspace-page-inner">
        <h1 className="page-title">{t('bible.title')}</h1>
        <div className="tabs" role="tablist">
          {tabs.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === candidate}
              onClick={() => setTab(candidate)}
            >
              {candidate === 'canon' ? t('bible.canon') : t(`bible.kind.${candidate}`)}
            </button>
          ))}
        </div>
        {isReadOnly ? (
          <p className="banner" role="status">
            {t('bible.readOnly')}
          </p>
        ) : null}
        {tab === 'canon' ? (
          <Canon isReadOnly={isReadOnly} change={props.change} onError={props.onError} />
        ) : (
          <CardShelf key={tab} kind={tab} isReadOnly={isReadOnly} change={props.change} onError={props.onError} />
        )}
      </div>
    </main>
  );
}

function detailLabel(t: Translate, language: 'ko' | 'en', summary: BibleCardSummary): string | undefined {
  if (summary.detail === undefined) {
    return undefined;
  }

  switch (summary.kind) {
    case 'character':
      return characterRoles.includes(summary.detail as CharacterCard['role'] & string)
        ? t(`bible.role.${summary.detail as 'main' | 'supporting' | 'extra'}`)
        : undefined;
    case 'narrator':
      return narratorPersons.includes(summary.detail as NarratorCard['person'])
        ? personLabel(language, summary.detail as NarratorCard['person'])
        : undefined;
    case 'background':
      return ['location', 'temporal', 'social'].includes(summary.detail)
        ? t(`bible.backgroundType.${summary.detail as 'location' | 'temporal' | 'social'}`)
        : undefined;
  }
}

interface ShelfProps {
  readonly kind: BibleCardKind;
  readonly isReadOnly: boolean;
  readonly change: WorkspaceChange;
  readonly onError: (message: string) => void;
}

function CardShelf(props: ShelfProps): JSX.Element {
  const { t, language } = useI18n();
  const [summaries, setSummaries] = useState<readonly BibleCardSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [card, setCard] = useState<BibleCard>();
  const [isCreating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<string>();

  const loadList = async (): Promise<void> => {
    const list = await call('bible.list', { kind: props.kind });
    setSummaries(list);
    setSelectedId((current) => current ?? list[0]?.id);
  };

  useEffect(() => {
    void loadList().catch((failure: unknown) => props.onError(messageOf(failure)));
  }, [props.change.sequence]);

  useEffect(() => {
    if (selectedId === undefined) {
      setCard(undefined);
      return;
    }
    setNotice(undefined);
    void call('bible.read', { kind: props.kind, id: selectedId })
      .then(setCard)
      .catch((failure: unknown) => props.onError(messageOf(failure)));
  }, [selectedId]);

  const save = async (): Promise<void> => {
    if (card === undefined) {
      return;
    }
    try {
      setCard(await call('bible.save', { kind: props.kind, card: card as unknown as Record<string, unknown> }));
      setNotice(t('bible.saved'));
      await loadList();
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  const create = async (): Promise<void> => {
    try {
      const created = await call('bible.create', { kind: props.kind, id: newId.trim(), name: newName.trim() });
      setCreating(false);
      setNewId('');
      setNewName('');
      await loadList();
      setSelectedId(created.id);
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  const remove = async (): Promise<void> => {
    if (card === undefined || !window.confirm(t('bible.deleteConfirm', { name: card.name }))) {
      return;
    }
    try {
      await call('bible.delete', { kind: props.kind, id: card.id });
      setSelectedId(undefined);
      await loadList();
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  return (
    <div className="split">
      <div className="stack">
        <ul className="list">
          {summaries.length === 0 ? <li className="muted">{t('bible.empty')}</li> : null}
          {summaries.map((summary) => (
            <li key={summary.id}>
              <button
                type="button"
                className="list-item"
                aria-current={summary.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(summary.id)}
              >
                <span>{summary.name}</span>
                <span className="muted small">{detailLabel(t, language, summary)}</span>
              </button>
            </li>
          ))}
        </ul>
        {isCreating ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="field">
              <span className="field-label">{t('bible.nameLabel')}</span>
              <input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
            </label>
            <label className="field">
              <span className="field-label">{t('bible.idLabel')}</span>
              <input className="input" value={newId} pattern="[a-z0-9][a-z0-9-]*" onChange={(event) => setNewId(event.target.value)} />
              <span className="field-hint">{t('bible.idHint')}</span>
            </label>
            <div className="row">
              <button type="button" className="button button-quiet" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="button button-primary" disabled={newId.trim() === '' || newName.trim() === ''}>
                {t('common.add')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="button" disabled={props.isReadOnly} onClick={() => setCreating(true)}>
            {t('bible.new')}
          </button>
        )}
      </div>

      {card === undefined ? (
        <div />
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={props.isReadOnly} className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
            <TextInput label={t('bible.nameLabel')} value={card.name} onChange={(name) => setCard({ ...card, name })} />
            {card.type === 'character' ? <CharacterFields card={card} onChange={setCard} /> : null}
            {card.type === 'narrator' ? <NarratorFields card={card} onChange={setCard} /> : null}
            {card.type !== 'character' && card.type !== 'narrator' ? <BackgroundFields card={card} onChange={setCard} /> : null}
          </fieldset>
          <div className="spread">
            <button type="button" className="button button-danger" disabled={props.isReadOnly} onClick={() => void remove()}>
              {t('common.delete')}
            </button>
            <span className="row">
              {notice === undefined ? null : <span className="muted small">{notice}</span>}
              <button type="submit" className="button button-primary" disabled={props.isReadOnly}>
                {t('common.save')}
              </button>
            </span>
          </div>
        </form>
      )}
    </div>
  );
}

function CharacterFields(props: { readonly card: CharacterCard; readonly onChange: (card: CharacterCard) => void }): JSX.Element {
  const { t } = useI18n();
  const { card } = props;

  return (
    <>
      <label className="field">
        <span className="field-label">{t('bible.roleLabel')}</span>
        <select
          className="select"
          value={card.role ?? 'main'}
          onChange={(event) => props.onChange({ ...card, role: event.target.value as CharacterCard['role'] })}
        >
          {characterRoles.map((role) => (
            <option key={role} value={role}>
              {t(`bible.role.${role}`)}
            </option>
          ))}
        </select>
      </label>
      <ListInput label={t('bible.description')} value={card.description} onChange={(description) => props.onChange({ ...card, description })} />
      <ListInput label={t('bible.traits')} value={card.traits} onChange={(traits) => props.onChange({ ...card, traits })} />
      <ListInput label={t('bible.voice')} value={card.voice} onChange={(voice) => props.onChange({ ...card, voice })} />
      <ListInput label={t('bible.desire')} value={card.desire} onChange={(desire) => props.onChange({ ...card, desire })} />
      <ListInput label={t('bible.aliases')} value={card.aliases} onChange={(aliases) => props.onChange({ ...card, aliases })} />
      <ListInput label={t('bible.tags')} value={card.tags} onChange={(tags) => props.onChange({ ...card, tags })} />
      <RelationsInput card={card} onChange={props.onChange} />
    </>
  );
}

function RelationsInput(props: { readonly card: CharacterCard; readonly onChange: (card: CharacterCard) => void }): JSX.Element {
  const { t } = useI18n();
  const relations = props.card.relations ?? [];
  const setRelations = (next: CharacterCard['relations']): void => props.onChange({ ...props.card, relations: next });

  return (
    <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="field-label">{t('bible.relations')}</legend>
      {relations.map((relation, index) => (
        <div key={index} className="row">
          <input
            className="input"
            aria-label={t('bible.relationTarget')}
            placeholder={t('bible.relationTarget')}
            value={relation.target}
            onChange={(event) => setRelations(relations.map((item, at) => (at === index ? { ...item, target: event.target.value } : item)))}
          />
          <input
            className="input"
            aria-label={t('bible.relationType')}
            placeholder={t('bible.relationType')}
            value={relation.type}
            onChange={(event) => setRelations(relations.map((item, at) => (at === index ? { ...item, type: event.target.value } : item)))}
          />
          <button type="button" className="button button-quiet" onClick={() => setRelations(relations.filter((_, at) => at !== index))}>
            {t('common.delete')}
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="button" onClick={() => setRelations([...relations, { target: '', type: '' }])}>
          {t('common.add')}
        </button>
      </div>
    </fieldset>
  );
}

function BackgroundFields(props: { readonly card: BackgroundCard; readonly onChange: (card: BackgroundCard) => void }): JSX.Element {
  const { t } = useI18n();
  const { card } = props;

  return (
    <>
      <label className="field">
        <span className="field-label">{t('bible.backgroundType')}</span>
        <select
          className="select"
          value={card.type}
          onChange={(event) =>
            props.onChange(
              event.target.value === 'location'
                ? { ...card, type: 'location', locationKind: 'place' }
                : ({ ...card, type: event.target.value } as BackgroundCard),
            )
          }
        >
          {(['location', 'temporal', 'social'] as const).map((type) => (
            <option key={type} value={type}>
              {t(`bible.backgroundType.${type}`)}
            </option>
          ))}
        </select>
      </label>
      <ListInput label={t('bible.description')} value={card.description} onChange={(description) => props.onChange({ ...card, description })} />
      <TextInput label={t('bible.time')} value={card.time ?? ''} onChange={(time) => props.onChange(withOptional(card, 'time', time))} />
      <TextInput label={t('bible.weather')} value={card.weather ?? ''} onChange={(weather) => props.onChange(withOptional(card, 'weather', weather))} />
      <ListInput label={t('bible.senses')} value={card.senses} onChange={(senses) => props.onChange({ ...card, senses })} />
      <ListInput label={t('bible.tags')} value={card.tags} onChange={(tags) => props.onChange({ ...card, tags })} />
    </>
  );
}

function NarratorFields(props: { readonly card: NarratorCard; readonly onChange: (card: NarratorCard) => void }): JSX.Element {
  const { t, language } = useI18n();
  const { card } = props;

  return (
    <>
      <div className="form-row">
        <label className="field">
          <span className="field-label">{t('bible.narratorPerson')}</span>
          <select className="select" value={card.person} onChange={(event) => props.onChange({ ...card, person: event.target.value as NarratorCard['person'] })}>
            {narratorPersons.map((person) => (
              <option key={person} value={person}>
                {personLabel(language, person)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('bible.narratorKnowledge')}</span>
          <select
            className="select"
            value={card.knowledge}
            onChange={(event) => props.onChange({ ...card, knowledge: event.target.value as NarratorCard['knowledge'] })}
          >
            {narratorKnowledges.map((knowledge) => (
              <option key={knowledge} value={knowledge}>
                {knowledgeLabel(language, knowledge)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('bible.narratorTense')}</span>
          <select
            className="select"
            value={card.tense ?? ''}
            onChange={(event) =>
              props.onChange(
                event.target.value === ''
                  ? withoutKey(card, 'tense')
                  : { ...card, tense: event.target.value as NonNullable<NarratorCard['tense']> },
              )
            }
          >
            <option value="">—</option>
            {narrativeTenses.map((tense) => (
              <option key={tense} value={tense}>
                {tenseLabel(language, tense)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TextInput label={t('bible.narratorFocal')} value={card.focal ?? ''} onChange={(focal) => props.onChange(withOptional(card, 'focal', focal))} />
      <ListInput label={t('bible.narratorVoice')} value={card.voice} onChange={(voice) => props.onChange({ ...card, voice })} />
    </>
  );
}

function withOptional<T extends object, K extends keyof T>(card: T, key: K, value: string): T {
  return value.trim() === '' ? withoutKey(card, key) : { ...card, [key]: value };
}

function withoutKey<T extends object, K extends keyof T>(card: T, key: K): T {
  const copy = { ...card };
  delete copy[key];
  return copy;
}

function TextInput(props: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input className="input" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

// A list field edits as plain lines, which is how a writer lists traits in a notebook.
function ListInput(props: {
  readonly label: string;
  readonly value: readonly string[] | undefined;
  readonly onChange: (value: string[]) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState((props.value ?? []).join('\n'));

  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <textarea
        className="textarea"
        rows={3}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          props.onChange(event.target.value.split('\n').map((line) => line.trim()).filter((line) => line.length > 0));
        }}
      />
      <span className="field-hint">{t('bible.listHint')}</span>
    </label>
  );
}

function Canon(props: { readonly isReadOnly: boolean; readonly change: WorkspaceChange; readonly onError: (message: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [facts, setFacts] = useState<readonly CanonFact[]>([]);
  const [subjects, setSubjects] = useState<readonly BibleCardSummary[]>([]);

  useEffect(() => {
    void Promise.all([call('canon.list', {}), call('bible.list', { kind: 'character' }), call('bible.list', { kind: 'background' })])
      .then(([loaded, characters, backgrounds]) => {
        setFacts(loaded);
        setSubjects([...characters, ...backgrounds]);
      })
      .catch((failure: unknown) => props.onError(messageOf(failure)));
  }, [props.change.sequence]);

  const save = async (fact: CanonFact): Promise<void> => {
    const stored: CanonFact = { ...fact };
    delete (stored as { subjectName?: string }).subjectName;
    try {
      setFacts(await call('canon.save', { fact: stored }));
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      setFacts(await call('canon.delete', { id }));
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  const firstSubject = subjects[0];

  return (
    <section className="stack">
      <p className="muted">{t('canon.intro')}</p>
      {facts.length === 0 ? <p className="muted">{t('canon.empty')}</p> : null}
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} subjects={subjects} isReadOnly={props.isReadOnly} onSave={save} onDelete={remove} />
      ))}
      <div>
        <button
          type="button"
          className="button"
          disabled={props.isReadOnly || firstSubject === undefined}
          onClick={() =>
            firstSubject !== undefined &&
            setFacts([
              ...facts,
              {
                id: `fact-${Date.now().toString(36)}`,
                subject: { kind: firstSubject.kind === 'background' ? 'background' : 'character', id: firstSubject.id },
                key: '',
                value: '',
                status: 'canon',
              },
            ])
          }
        >
          {t('canon.add')}
        </button>
      </div>
    </section>
  );
}

function FactRow(props: {
  readonly fact: CanonFact;
  readonly subjects: readonly BibleCardSummary[];
  readonly isReadOnly: boolean;
  readonly onSave: (fact: CanonFact) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const [fact, setFact] = useState(props.fact);
  const subjectValue = `${fact.subject.kind}:${fact.subject.id}`;
  const isComplete = fact.key.trim() !== '' && fact.value.trim() !== '';

  return (
    <div className="fact">
      <select
        className="select"
        aria-label={t('canon.subject')}
        value={subjectValue}
        disabled={props.isReadOnly}
        onChange={(event) => {
          const [kind, id] = event.target.value.split(':');
          setFact({ ...fact, subject: { kind: kind === 'background' ? 'background' : 'character', id: id ?? '' } });
        }}
      >
        {props.subjects.map((subject) => (
          <option key={`${subject.kind}:${subject.id}`} value={`${subject.kind}:${subject.id}`}>
            {subject.name}
          </option>
        ))}
      </select>
      <input
        className="input"
        aria-label={t('canon.key')}
        placeholder={t('canon.key')}
        value={fact.key}
        disabled={props.isReadOnly}
        onChange={(event) => setFact({ ...fact, key: event.target.value })}
        onBlur={() => isComplete && void props.onSave(fact)}
      />
      <input
        className="input"
        aria-label={t('canon.value')}
        placeholder={t('canon.value')}
        value={fact.value}
        disabled={props.isReadOnly}
        onChange={(event) => setFact({ ...fact, value: event.target.value })}
        onBlur={() => isComplete && void props.onSave(fact)}
      />
      <span className="row">
        {fact.status === 'candidate' ? (
          <button
            type="button"
            className="button"
            disabled={props.isReadOnly || !isComplete}
            onClick={() => void props.onSave({ ...fact, status: 'canon' })}
          >
            {t('canon.promote')}
          </button>
        ) : (
          <span className="muted small">{t('canon.status.canon')}</span>
        )}
        <button type="button" className="button button-quiet" disabled={props.isReadOnly} onClick={() => void props.onDelete(fact.id)}>
          {t('common.delete')}
        </button>
      </span>
    </div>
  );
}
