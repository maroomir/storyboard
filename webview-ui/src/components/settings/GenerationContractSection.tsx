import { AlertTriangle, CheckCircle2 } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"

import { ListField } from "../editor/fields/ListField"
import { SectionHeader } from "../ui/SectionHeader"

const sbInputClass =
  "w-full rounded-md border border-[color:var(--vscode-input-border)] bg-sb-bg-input px-3 py-2 text-sb-fg-input outline-none transition focus:border-sb-border-focus focus:ring-1 focus:ring-sb-border-focus/40"

const sbSelectClass = `${sbInputClass} max-w-md`

const sectionCardClass =
  "flex flex-col gap-4 rounded-lg border border-sb-border bg-sb-bg-sidebar/80 p-4"

const fieldGroupClass = "flex max-w-md flex-col gap-1.5"

const POV_OPTIONS = [
  { id: "first", label: "1인칭" },
  { id: "third-limited", label: "3인칭 제한적 시점" },
  { id: "third-omniscient", label: "3인칭 전지적 시점" }
] as const

type PointOfView = (typeof POV_OPTIONS)[number]["id"]

const CONTRACT_FIELD_LABELS: Record<string, string> = {
  genre: "장르",
  audience: "독자층",
  pov: "시점",
  targetWordCount: "목표 분량"
}

interface ContractSetting {
  readonly genre?: string
  readonly audience?: string
  readonly pov?: PointOfView
  readonly targetWordCount?: number
  readonly prohibitions: readonly string[]
  readonly styleConstraints: readonly string[]
  readonly qualityCriteria: readonly string[]
}

interface ContractReadiness {
  readonly isReady: boolean
  readonly missing: readonly string[]
  readonly warnings: readonly string[]
}

interface ContractSnapshot {
  readonly isStoryboardProject: boolean
  readonly format?: string
  readonly setting?: ContractSetting
  readonly readiness: ContractReadiness
}

interface ContractDraft {
  genre: string
  audience: string
  pov: PointOfView | ""
  targetWordCount: string
  prohibitions: string[]
  styleConstraints: string[]
  qualityCriteria: string[]
}

function isPointOfView(value: string): value is PointOfView {
  return POV_OPTIONS.some((option) => option.id === value)
}

function parseContractSnapshot(value: unknown): ContractSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.isStoryboardProject !== "boolean") {
    return undefined
  }

  const readiness = candidate.readiness as Record<string, unknown> | undefined
  if (
    !readiness ||
    typeof readiness.isReady !== "boolean" ||
    !Array.isArray(readiness.missing) ||
    !Array.isArray(readiness.warnings)
  ) {
    return undefined
  }

  return candidate as unknown as ContractSnapshot
}

function toDraft(setting: ContractSetting | undefined): ContractDraft {
  return {
    genre: setting?.genre ?? "",
    audience: setting?.audience ?? "",
    pov: setting?.pov ?? "",
    targetWordCount: setting?.targetWordCount !== undefined ? String(setting.targetWordCount) : "",
    prohibitions: setting ? [...setting.prohibitions] : [],
    styleConstraints: setting ? [...setting.styleConstraints] : [],
    qualityCriteria: setting ? [...setting.qualityCriteria] : []
  }
}

function buildUpdatePayload(draft: ContractDraft): Record<string, unknown> {
  const targetWordCount = parsePositiveInt(draft.targetWordCount)

  return {
    genre: draft.genre,
    audience: draft.audience,
    pov: draft.pov === "" ? null : draft.pov,
    targetWordCount,
    prohibitions: draft.prohibitions,
    styleConstraints: draft.styleConstraints,
    qualityCriteria: draft.qualityCriteria
  }
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function ReadinessBanner({ readiness }: { readonly readiness: ContractReadiness }): React.ReactElement {
  if (readiness.isReady) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-sb-border-focus bg-sb-bg-widget/70 px-3 py-2 text-sm text-sb-fg">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        <span>생성 계약이 준비되었습니다.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-sb-border-warning bg-sb-bg-widget/70 px-3 py-2 text-sm text-sb-fg">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <span>원클릭 생성 전에 아래 항목을 확인하세요.</span>
      </div>
      {readiness.missing.length > 0 ? (
        <p className="m-0 text-xs text-sb-fg-muted">
          누락: {readiness.missing.map((key) => CONTRACT_FIELD_LABELS[key] ?? key).join(", ")}
        </p>
      ) : null}
      {readiness.warnings.map((warning, index) => (
        <p key={`warning-${index}`} className="m-0 text-xs text-sb-fg-muted">
          {warning}
        </p>
      ))}
    </div>
  )
}

export function GenerationContractSection({
  callRpc,
  onRpcError
}: {
  readonly callRpc: (method: string, payload: Record<string, unknown>) => Promise<unknown>
  readonly onRpcError: (message: string) => void
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState<ContractSnapshot | undefined>(undefined)
  const [draft, setDraft] = useState<ContractDraft | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void callRpc("project.readContract", {})
      .then((payload) => {
        if (!active) {
          return
        }

        const next = parseContractSnapshot(payload)
        if (!next) {
          setLoadError("작품 계약을 불러오지 못했습니다.")
          return
        }

        setSnapshot(next)
        setDraft(toDraft(next.setting))
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "작품 계약을 불러오지 못했습니다.")
        }
      })

    return () => {
      active = false
    }
  }, [callRpc])

  const save = (nextDraft: ContractDraft): void => {
    setDraft(nextDraft)
    void callRpc("project.updateContract", buildUpdatePayload(nextDraft))
      .then((payload) => {
        const next = parseContractSnapshot(payload)
        if (next) {
          setSnapshot(next)
        }
      })
      .catch((error: unknown) => {
        onRpcError(error instanceof Error ? error.message : "작품 계약을 저장하지 못했습니다.")
      })
  }

  const header = useMemo(
    () => (
      <SectionHeader
        title="작품 계약"
        description="장르, 독자층, 시점, 목표 분량, 금지 조건, 문체 제약, 품질 기준을 작품 생성 계약으로 저장합니다. 값은 .storyboard/project.json에 기록됩니다."
      />
    ),
    []
  )

  if (loadError) {
    return (
      <section className={sectionCardClass} aria-label="작품 계약">
        {header}
        <p className="m-0 text-sm text-sb-fg-error">{loadError}</p>
      </section>
    )
  }

  if (!snapshot || !draft) {
    return (
      <section className={sectionCardClass} aria-label="작품 계약">
        {header}
        <p className="m-0 text-sm text-sb-fg-muted">불러오는 중…</p>
      </section>
    )
  }

  if (!snapshot.isStoryboardProject) {
    return (
      <section className={sectionCardClass} aria-label="작품 계약">
        {header}
        <p className="m-0 text-sm text-sb-fg-muted">
          Storyboard 프로젝트 폴더에서만 작품 계약을 편집할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <section className={sectionCardClass} aria-label="작품 계약">
      {header}
      <ReadinessBanner readiness={snapshot.readiness} />

      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={fieldGroupClass}>
          <span className="text-sm font-medium text-sb-fg">장르</span>
          <input
            className={sbInputClass}
            value={draft.genre}
            placeholder="예: 성장 판타지"
            onChange={(event) => setDraft({ ...draft, genre: event.target.value })}
            onBlur={() => save(draft)}
          />
        </label>

        <label className={fieldGroupClass}>
          <span className="text-sm font-medium text-sb-fg">독자층</span>
          <input
            className={sbInputClass}
            value={draft.audience}
            placeholder="예: 10대 후반"
            onChange={(event) => setDraft({ ...draft, audience: event.target.value })}
            onBlur={() => save(draft)}
          />
        </label>

        <label className={fieldGroupClass}>
          <span className="text-sm font-medium text-sb-fg">시점</span>
          <select
            className={sbSelectClass}
            value={draft.pov}
            onChange={(event) => {
              const value = event.target.value
              save({ ...draft, pov: value === "" || !isPointOfView(value) ? "" : value })
            }}
          >
            <option value="">선택 안 함</option>
            {POV_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={fieldGroupClass}>
          <span className="text-sm font-medium text-sb-fg">목표 분량 (자)</span>
          <input
            className={sbInputClass}
            type="number"
            min={1}
            step={1000}
            value={draft.targetWordCount}
            placeholder="예: 120000"
            onChange={(event) => setDraft({ ...draft, targetWordCount: event.target.value })}
            onBlur={() => save(draft)}
          />
        </label>
      </div>

      <div className="grid max-w-3xl grid-cols-1 gap-4">
        <ListField
          label="금지 조건"
          values={draft.prohibitions}
          onChange={(values) => save({ ...draft, prohibitions: values })}
        />
        <ListField
          label="문체 제약"
          values={draft.styleConstraints}
          onChange={(values) => save({ ...draft, styleConstraints: values })}
        />
        <ListField
          label="품질 기준"
          values={draft.qualityCriteria}
          onChange={(values) => save({ ...draft, qualityCriteria: values })}
        />
      </div>
    </section>
  )
}
