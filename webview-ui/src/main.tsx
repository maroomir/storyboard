import React from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"

function App(): React.ReactElement {
  return (
    <main className="placeholder">
      <p className="eyebrow">Storyboard</p>
      <h1>Coming soon: Phase 2</h1>
      <p className="description">
        캐릭터, 배경, 씬을 탐색하는 사이드바가 이 위치에 표시될 예정입니다.
      </p>
    </main>
  )
}

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
