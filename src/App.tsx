import { useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { Whiteboard } from './components/Whiteboard';
import { TopBar } from './components/TopBar';
import { FileSidebar } from './components/FileSidebar';
import { testLocalStorageAdapter } from './storage/localStorageAdapter';
import { useDrawingPersistence } from './hooks/useDrawingPersistence';
import './App.css';

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  const persistence = useDrawingPersistence({
    storage: testLocalStorageAdapter,
    api: excalidrawAPI,
  });

  return (
    <div className="app-container">
      <TopBar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        currentFileName={persistence.currentFileName}
        saveStatus={persistence.saveStatus}
        lastSavedAt={persistence.lastSavedAt}
        onSave={persistence.saveNow}
        onNew={() => persistence.createNewDrawing('Untitled')}
        onRename={(newName) => {
          if (persistence.currentFileId) {
            persistence.renameDrawing(persistence.currentFileId, newName);
          }
        }}
      />
      <div style={{ display: 'flex', flex: 1, height: 'calc(100vh - 44px)', overflow: 'hidden' }}>
        <FileSidebar
          isOpen={isSidebarOpen}
          files={persistence.files}
          currentFileId={persistence.currentFileId}
          onSelectFile={persistence.openDrawing}
          onNewFile={() => persistence.createNewDrawing('Untitled')}
          onRenameFile={persistence.renameDrawing}
          onDeleteFile={persistence.deleteDrawing}
        />
        <main className="canvas-container">
          {persistence.errorMessage && (
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 100,
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid #f87171',
                fontSize: '13px',
              }}
            >
              {persistence.errorMessage}
            </div>
          )}
          <Whiteboard
            onApiReady={setExcalidrawAPI}
            onChange={persistence.handleCanvasChange}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
