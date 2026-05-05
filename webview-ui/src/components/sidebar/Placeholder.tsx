import type React from "react"

export function SidebarPlaceholder(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-3 p-5">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
      <h1 className="m-0 text-xl leading-snug text-sb-fg">Coming soon: Phase 2</h1>
      <p className="m-0 leading-normal text-sb-fg-muted">
        캐릭터, 배경, 씬을 탐색하는 사이드바가 이 위치에 표시될 예정입니다.
      </p>
    </main>
  )
}
