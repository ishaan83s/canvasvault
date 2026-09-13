import { useState, useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { Whiteboard } from './components/Whiteboard';
import { TopBar } from './components/TopBar';
import { FileSidebar } from './components/FileSidebar';
import { StorageMigrationModal } from './components/StorageMigrationModal';
import { SignOutConfirmationModal } from './components/SignOutConfirmationModal';
import { useDrawingPersistence } from './hooks/useDrawingPersistence';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/AuthContext';
import { testLocalStorageAdapter } from './storage/localStorageAdapter';
import { migrateLocalDrawingsToDrive, type MigrationDriveTarget } from './storage/migrationService';
import './App.css';

function MainLayout() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  const auth = useAuth();
  const isAuthenticated = auth.state.status === 'authenticated' && !!auth.state.accessToken;

  // Session-generation tracking: changes only on actual sign-in, not token refresh
  const [sessionGen, setSessionGen] = useState<number>(0);
  const [resolvedSessionGen, setResolvedSessionGen] = useState<number | null>(null);
  const prevAuthRef = useRef<boolean>(false);
  const [localDrawingCount, setLocalDrawingCount] = useState<number>(0);

  const persistence = useDrawingPersistence({
    api: excalidrawAPI,
  });

  useEffect(() => {
    if (!prevAuthRef.current && isAuthenticated) {
      setSessionGen((g) => g + 1);
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Inspect local storage drawings when a new authenticated session starts
  useEffect(() => {
    if (!isAuthenticated || sessionGen === 0 || sessionGen === resolvedSessionGen) {
      return;
    }

    let isMounted = true;
    testLocalStorageAdapter
      .list()
      .then((localFiles) => {
        if (!isMounted) return;
        setLocalDrawingCount(localFiles.length);
        if (localFiles.length === 0) {
          setResolvedSessionGen(sessionGen);
        }
      })
      .catch((err) => {
        console.warn('Failed to inspect local storage for migration:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, sessionGen, resolvedSessionGen]);

  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState<boolean>(false);
  const [signOutSaveError, setSignOutSaveError] = useState<string | null>(null);

  const isMigrationModalOpen =
    isAuthenticated &&
    !isSignOutModalOpen &&
    sessionGen > 0 &&
    sessionGen !== resolvedSessionGen &&
    localDrawingCount > 0;

  const handleSkipMigration = () => {
    setResolvedSessionGen(sessionGen);
  };

  const handleImportMigration = async () => {
    if (!persistence.driveAdapter) {
      throw new Error('Google Drive adapter is not ready');
    }
    return migrateLocalDrawingsToDrive({
      localStorage: testLocalStorageAdapter,
      driveStorage: persistence.driveAdapter as unknown as MigrationDriveTarget,
    });
  };

  const handleCloseMigration = () => {
    setResolvedSessionGen(sessionGen);
    // Refresh sidebar files from Drive without touching active scene
    persistence.refreshFiles();
  };

  const handleSignOutRequest = () => {
    const isUnsafeSignOut =
      persistence.storageMode === 'drive' &&
      (persistence.isSaving ||
        persistence.saveStatus === 'dirty' ||
        persistence.saveStatus === 'error' ||
        persistence.saveStatus === 'saving');

    if (isUnsafeSignOut) {
      setSignOutSaveError(null);
      setIsSignOutModalOpen(true);
    } else {
      auth.signOut();
    }
  };

  const handleSaveAndSignOut = async (): Promise<boolean> => {
    const startGen = persistence.generation;
    setSignOutSaveError(null);

    try {
      const success = await persistence.saveNow();
      if (!success || persistence.generation !== startGen) {
        setSignOutSaveError(
          persistence.errorMessage || 'Failed to save drawing to Google Drive. You remain signed in.'
        );
        return false;
      }

      setIsSignOutModalOpen(false);
      auth.signOut();
      return true;
    } catch (err) {
      setSignOutSaveError(err instanceof Error ? err.message : 'Save failed. You remain signed in.');
      return false;
    }
  };

  const handleSignOutWithoutSaving = async () => {
    await persistence.discardUnsavedDriveChanges();
    setIsSignOutModalOpen(false);
    setSignOutSaveError(null);
    auth.signOut();
  };

  const handleCancelSignOut = () => {
    setIsSignOutModalOpen(false);
    setSignOutSaveError(null);
  };

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
        onSignOutRequest={handleSignOutRequest}
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
      <StorageMigrationModal
        isOpen={isMigrationModalOpen}
        localDrawingCount={localDrawingCount}
        onImport={handleImportMigration}
        onSkip={handleSkipMigration}
        onClose={handleCloseMigration}
      />
      <SignOutConfirmationModal
        isOpen={isSignOutModalOpen}
        onSaveAndSignOut={handleSaveAndSignOut}
        onSignOutWithoutSaving={handleSignOutWithoutSaving}
        onCancel={handleCancelSignOut}
        saveErrorMessage={signOutSaveError}
      />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}

export default App;
