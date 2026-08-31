import { Sparkles } from "lucide-react"
import type React from "react"

export function SidebarPlaceholder(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-4 p-5">
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-sb-border bg-sb-parchment/50 p-5 shadow-cardRest">
        <Sparkles className="h-9 w-9 shrink-0 text-sb-accent-character" aria-hidden />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
          <h1 className="font-display m-0 text-2xl leading-snug text-sb-fg">Phase 2로 곧 이어집니다</h1>
          <p className="m-0 max-w-md text-sm leading-relaxed text-sb-fg-muted">
            캐릭터·배경·씬을 한곳에서 탐색하는 Storyboard 사이드바가 이 자리에 연결될 예정입니다.
          </p>
        </div>
      </div>
    </main>
  )
}
