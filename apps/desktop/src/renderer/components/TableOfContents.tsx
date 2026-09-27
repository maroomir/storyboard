import type { WorkspaceOverview } from '@/shared/dto';

import { useI18n } from '@/renderer/lib/i18n';

interface TableOfContentsProps {
  readonly overview: WorkspaceOverview;
  readonly selectedStem: string | undefined;
  readonly onSelect: (stem: string) => void;
}

export function TableOfContents(props: TableOfContentsProps): JSX.Element {
  const { t, language } = useI18n();
  const target = props.overview.targetWordCount;
  const progress = target === undefined || target === 0 ? undefined : Math.min(1, props.overview.totalLength / target);

  return (
    <nav className="toc" aria-label={t('desk.toc')}>
      <div className="toc-heading">{t('desk.toc')}</div>
      {props.overview.chapters.map((chapter, chapterIndex) => (
        <section key={`${chapter.title}-${chapterIndex}`} aria-label={chapter.title || t('desk.untitledChapter')}>
          <div className="toc-chapter">{chapter.title || t('desk.untitledChapter')}</div>
          {chapter.scenes.map((scene) => (
            <button
              key={scene.stem}
              type="button"
              className="toc-scene"
              aria-current={scene.stem === props.selectedStem ? 'true' : undefined}
              onClick={() => props.onSelect(scene.stem)}
            >
              <span className="status-dot" data-status={scene.status} aria-hidden="true" />
              <span>
                {scene.order} {scene.title}
              </span>
              <span className="sr-only">{t(`status.${scene.status}`)}</span>
            </button>
          ))}
        </section>
      ))}
      <div className="toc-total">
        <div className="spread">
          <span>{t('desk.totalLength')}</span>
          <span>{t('common.characters', { count: props.overview.totalLength.toLocaleString(language) })}</span>
        </div>
        {target === undefined ? null : (
          <div className="spread">
            <span>{t('desk.target')}</span>
            <span>{t('common.characters', { count: target.toLocaleString(language) })}</span>
          </div>
        )}
        {progress === undefined ? null : (
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
    </nav>
  );
}
