import React from 'react';
import { createRoot } from 'react-dom/client';

import '@webview/lib/types';
import { CardEditor } from '@webview/components/editor/CardEditor';
import {
  parseRelationGraphInitialData,
  RelationGraph,
} from '@webview/components/relation/RelationGraphView';
import { SettingsView } from '@webview/components/settings/SettingsView';
import { CardsSidebar } from '@webview/components/sidebar/CardsSidebar';
import { SidebarPlaceholder } from '@webview/components/sidebar/Placeholder';
import { ScenesSidebar } from '@webview/components/sidebar/ScenesSidebar';
import { StudioSidebar } from '@webview/components/sidebar/StudioSidebar';
import {
  parseCardEditorInitialData,
  parseSidebarCardsInitialData,
  parseSidebarScenesInitialData,
  parseStudioInitialData,
} from '@webview/lib/messaging';
import './styles.css';

function App(): React.ReactElement {
  if (window.__STORYBOARD_VIEW__ === 'card-editor') {
    return (
      <CardEditor initialData={parseCardEditorInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
    );
  }

  if (window.__STORYBOARD_VIEW__ === 'cards-sidebar') {
    return (
      <CardsSidebar
        initialData={parseSidebarCardsInitialData(window.__STORYBOARD_INITIAL_DATA__)}
      />
    );
  }

  if (window.__STORYBOARD_VIEW__ === 'scenes-sidebar') {
    return (
      <ScenesSidebar
        initialData={parseSidebarScenesInitialData(window.__STORYBOARD_INITIAL_DATA__)}
      />
    );
  }

  if (window.__STORYBOARD_VIEW__ === 'studio-sidebar') {
    return (
      <StudioSidebar initialData={parseStudioInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
    );
  }

  if (window.__STORYBOARD_VIEW__ === 'relation-graph') {
    return (
      <RelationGraph
        initialData={parseRelationGraphInitialData(window.__STORYBOARD_INITIAL_DATA__)}
      />
    );
  }

  if (window.__STORYBOARD_VIEW__ === 'settings') {
    return <SettingsView initialData={window.__STORYBOARD_INITIAL_DATA__} />;
  }

  return <SidebarPlaceholder />;
}

const rootElement: HTMLElement | null = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
