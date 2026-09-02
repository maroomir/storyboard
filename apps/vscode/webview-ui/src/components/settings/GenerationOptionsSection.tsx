import React, { useMemo, useState } from 'react';

import { Button } from '../ui/Button';
import { SectionHeader } from '../ui/SectionHeader';
import { OriginPill } from './SettingsPrimitives';
import {
  getValueOrigin,
  parseSaveTarget,
  type SaveTarget,
  type SettingDefinition,
  type SettingsReadSnapshot,
  type SettingValue,
} from './settingsSnapshot';
import { sbInputClass, sectionCardClass } from './settingsStyles';

export interface SettingsSectionProps {
  readonly snapshot: SettingsReadSnapshot;
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
  readonly onRpcError: (message: string) => void;
  readonly onSaved: (label: string, target: SaveTarget) => void;
}

export function GenerationOptionsSection({
  snapshot,
  callRpc,
  onRpcError,
  onSaved,
}: SettingsSectionProps): React.ReactElement {
  const groups = useMemo(
    () => groupDefinitions(snapshot.settingCatalog),
    [snapshot.settingCatalog],
  );

  const save = (definition: SettingDefinition, value: SettingValue): void => {
    void callRpc('settings.updateSettingValue', { key: definition.key, value })
      .then((payload) => onSaved(definition.label, parseSaveTarget(payload)))
      .catch((error: unknown) => {
        onRpcError(
          error instanceof Error ? error.message : `${definition.label}을(를) 저장하지 못했습니다.`,
        );
      });
  };

  return (
    <section className={sectionCardClass} aria-label="생성 옵션">
      <SectionHeader
        title="생성 옵션"
        description="초안 생성·검수·편집기 동작을 조정합니다. 값마다 어느 설정 파일에서 왔는지 표시됩니다."
      />
      {groups.map(([group, definitions]) => (
        <div key={group} className="flex flex-col gap-2">
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
            {group}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {definitions.map((definition) => (
              <OptionRow
                key={definition.key}
                definition={definition}
                value={snapshot.settingValues[definition.key] ?? definition.defaultValue}
                origin={getValueOrigin(snapshot, definition.key)}
                originFile={
                  getValueOrigin(snapshot, definition.key) === 'workspace'
                    ? snapshot.configFiles.workspace
                    : snapshot.configFiles.user
                }
                onSave={(value) => save(definition, value)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function OptionRow({
  definition,
  value,
  origin,
  originFile,
  onSave,
}: {
  readonly definition: SettingDefinition;
  readonly value: SettingValue;
  readonly origin: ReturnType<typeof getValueOrigin>;
  readonly originFile: string | undefined;
  readonly onSave: (value: SettingValue) => void;
}): React.ReactElement {
  const inputId = `option-${definition.key.replace(/\./g, '-')}`;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sb-border bg-sb-bg-widget/60 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label className="flex items-center gap-2 text-sm font-medium text-sb-fg" htmlFor={inputId}>
          <span>{definition.label}</span>
          <OriginPill origin={origin} file={originFile} />
        </label>
        <p className="m-0 text-xs text-sb-fg-muted">{definition.description}</p>
      </div>
      <OptionControl inputId={inputId} definition={definition} value={value} onSave={onSave} />
    </li>
  );
}

function OptionControl({
  inputId,
  definition,
  value,
  onSave,
}: {
  readonly inputId: string;
  readonly definition: SettingDefinition;
  readonly value: SettingValue;
  readonly onSave: (value: SettingValue) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null);

  if (definition.kind === 'boolean') {
    return (
      <input
        id={inputId}
        type="checkbox"
        className="h-4 w-4 cursor-pointer"
        checked={value === true}
        onChange={(event) => onSave(event.target.checked)}
      />
    );
  }

  const current = draft ?? String(value);
  const commit = (): void => {
    if (draft === null) {
      return;
    }

    const next = definition.kind === 'integer' ? Number.parseInt(draft, 10) : draft.trim();

    if (definition.kind === 'integer' && Number.isNaN(next as number)) {
      setDraft(null);
      return;
    }

    setDraft(null);

    if (next !== value) {
      onSave(next);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        id={inputId}
        type={definition.kind === 'integer' ? 'number' : 'text'}
        className={`${sbInputClass} w-28`}
        value={current}
        min={definition.minimum}
        max={definition.maximum}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          }
        }}
      />
      {draft !== null && draft !== String(value) ? (
        <Button type="button" variant="secondary" className="shrink-0" onClick={commit}>
          적용
        </Button>
      ) : null}
    </div>
  );
}

function groupDefinitions(
  catalog: readonly SettingDefinition[],
): ReadonlyArray<readonly [string, readonly SettingDefinition[]]> {
  const byGroup = new Map<string, SettingDefinition[]>();

  for (const definition of catalog) {
    const list = byGroup.get(definition.group) ?? [];
    list.push(definition);
    byGroup.set(definition.group, list);
  }

  return [...byGroup.entries()];
}
