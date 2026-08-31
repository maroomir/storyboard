import React from "react"
import { createRoot } from "react-dom/client"

import "./lib/types"
import { CardEditor } from "./components/editor/CardEditor"
import { parseRelationGraphInitialData, RelationGraph } from "./components/relation/RelationGraphView"
import { SettingsView } from "./components/settings/SettingsView"
import { CardsSidebar } from "./components/sidebar/CardsSidebar"
import { SidebarPlaceholder } from "./components/sidebar/Placeholder"
import { ScenesSidebar } from "./components/sidebar/ScenesSidebar"
import { StudioSidebar } from "./components/sidebar/StudioSidebar"
import {
  parseCardEditorInitialData,
  parseSidebarCardsInitialData,
  parseSidebarScenesInitialData,
  parseStudioInitialData
} from "./lib/messaging"
import "./styles.css"

function App(): React.ReactElement {
  if (window.__STORYBOARD_VIEW__ === "card-editor") {
    return <CardEditor initialData={parseCardEditorInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "cards-sidebar") {
    return <CardsSidebar initialData={parseSidebarCardsInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "scenes-sidebar") {
    return <ScenesSidebar initialData={parseSidebarScenesInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "studio-sidebar") {
    return <StudioSidebar initialData={parseStudioInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "relation-graph") {
    return <RelationGraph initialData={parseRelationGraphInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "settings") {
    return <SettingsView initialData={window.__STORYBOARD_INITIAL_DATA__} />
  }

  return <SidebarPlaceholder />
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
