import { useState, useEffect, useRef, useCallback } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { CaptureUpdateAction, getSceneVersion } from '@excalidraw/excalidraw';
import type { DrawingFile, DrawingStorage, SaveStatus, StorageMode } from '../storage/types';
import {
  serializeDrawing,
  deserializeDrawing,
  stripExcalidrawExtension,
  createEmptyDrawing,
} from '../utils/excalidrawSerialization';
import { useDebouncedSave } from './useDebouncedSave';
import { useStorageSelection, type UseStorageSelectionResult } from './useStorageSelection';

const LAST_OPENED_KEY = 'canvasvault_last_opened_id';

export interface UseDrawingPersistenceOptions {
  api: ExcalidrawImperativeAPI | null;
  storage?: DrawingStorage;
  storageSelection?: UseStorageSelectionResult;
}

export function useDrawingPersistence({
  api,
  storage: explicitStorage,
  storageSelection: explicitSelection,
}: UseDrawingPersistenceOptions) {
  // Integrate storage selection: selects LocalStorage for anonymous, Drive for authenticated
  const autoSelection = useStorageSelection();
  const selection = explicitSelection ?? autoSelection;
  const storage = explicitStorage ?? selection.activeStorage;
  const storageMode: StorageMode = explicitStorage ? 'local' : selection.storageMode;
  const generation: number = explicitStorage ? 0 : selection.generation;

  const [files, setFiles] = useState<DrawingFile[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>('Untitled');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Generation guard to prevent stale async operations from mutating state
  const storageGenerationRef = useRef<number>(generation);
  const previousModeRef = useRef<StorageMode>(storageMode);

  // Synchronous tracking of current active file ID to prevent duplicate file creations
  const currentFileIdRef = useRef<string | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const isMountedInitRef = useRef<boolean>(false);

  // Track serialized representation and element version
  const lastSavedContentRef = useRef<string>('');
  const lastSceneVersionRef = useRef<number>(0);
  const isInitializingRef = useRef<boolean>(true);

  // Refresh files scoped to current storage and generation
  const refreshFiles = useCallback(async () => {
    const opGen = storageGenerationRef.current;
    try {
      const list = await storage.list();
      if (opGen !== storageGenerationRef.current) {
        return [];
      }
      setFiles(list);
      return list;
    } catch (err) {
      if (opGen !== storageGenerationRef.current) {
        return [];
      }
      console.error('Failed to list files:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to list drawings');
      return [];
    }
  }, [storage]);

  // Actual save execution: handles first-save vs update and never silently falls back
  const executeSave = useCallback(async () => {
    if (!api) return;
    if (isSavingRef.current) return;

    const opGen = storageGenerationRef.current;
    isSavingRef.current = true;

    try {
      setSaveStatus('saving');
      setErrorMessage(null);

      const elements = api.getSceneElementsIncludingDeleted();
      const appState = api.getAppState();
      const binaryFiles = api.getFiles();

      const serialized = serializeDrawing(elements, appState, binaryFiles);

      let targetId = currentFileIdRef.current;
      if (!targetId) {
        // First save on a new/transient drawing: create exactly once
        targetId = await storage.create(currentFileName, serialized);
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        currentFileIdRef.current = targetId;
        setCurrentFileId(targetId);
        if (storageMode === 'local') {
          localStorage.setItem(LAST_OPENED_KEY, targetId);
        }
      } else {
        // Subsequent save: update existing file
        await storage.update(targetId, serialized);
        if (opGen !== storageGenerationRef.current) {
          return;
        }
      }

      lastSavedContentRef.current = serialized;
      lastSceneVersionRef.current = getSceneVersion(elements);
      setLastSavedAt(new Date());
      setSaveStatus('saved');
      await refreshFiles();
    } catch (err) {
      if (opGen !== storageGenerationRef.current) {
        return;
      }
      console.error('Save failed:', err);
      setSaveStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Save failed');
      // Zero silent fallback to LocalStorage! Scene remains in-memory dirty for manual retry.
    } finally {
      isSavingRef.current = false;
    }
  }, [api, currentFileName, storage, storageMode, refreshFiles]);

  const { trigger: triggerDebouncedSave, cancel: cancelDebouncedSave } = useDebouncedSave({
    delayMs: 1500,
    onSave: executeSave,
  });

  // Called by Excalidraw onChange
  const handleCanvasChange = useCallback(
    (elements: readonly any[], _appState: any, _binaryFiles: any) => {
      if (isInitializingRef.current || !api) return;

      const currentVersion = getSceneVersion(elements);
      if (currentVersion !== lastSceneVersionRef.current) {
        setSaveStatus('dirty');
        triggerDebouncedSave();
      }
    },
    [api, triggerDebouncedSave]
  );

  // Open a specific drawing
  const openDrawing = useCallback(
    async (fileId: string) => {
      if (!api) return;

      cancelDebouncedSave();
      const opGen = storageGenerationRef.current;
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const rawContent = await storage.get(fileId);
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        const restored = deserializeDrawing(rawContent);

        // Load into Excalidraw
        isInitializingRef.current = true;
        api.resetScene();
        api.updateScene({
          elements: restored.elements,
          appState: {
            ...restored.appState,
            collaborators: new Map(),
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });

        if (restored.files && Object.keys(restored.files).length > 0) {
          api.addFiles(Object.values(restored.files));
        }

        api.history.clear();

        lastSavedContentRef.current = rawContent;
        lastSceneVersionRef.current = getSceneVersion(restored.elements);

        const fileList = await refreshFiles();
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        const found = fileList.find((f) => f.id === fileId);
        const name = found ? stripExcalidrawExtension(found.name) : 'Untitled';

        currentFileIdRef.current = fileId;
        setCurrentFileId(fileId);
        setCurrentFileName(name);
        setSaveStatus('saved');
        setLastSavedAt(found ? new Date(found.updatedAt) : new Date());

        if (storageMode === 'local') {
          localStorage.setItem(LAST_OPENED_KEY, fileId);
        }
      } catch (err) {
        if (opGen !== storageGenerationRef.current) {
          return;
        }
        console.error('Failed to open drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to open drawing');
      } finally {
        if (opGen === storageGenerationRef.current) {
          setIsLoading(false);
          setTimeout(() => {
            isInitializingRef.current = false;
          }, 100);
        }
      }
    },
    [api, cancelDebouncedSave, storage, storageMode, refreshFiles]
  );

  // Create a new blank drawing
  const createNewDrawing = useCallback(
    async (name: string = 'Untitled') => {
      if (!api) return;

      cancelDebouncedSave();
      const opGen = storageGenerationRef.current;
      setIsLoading(true);

      try {
        const emptyContent = createEmptyDrawing(name);
        const newId = await storage.create(name, emptyContent);
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        isInitializingRef.current = true;
        api.resetScene();
        api.history.clear();

        lastSavedContentRef.current = emptyContent;
        lastSceneVersionRef.current = 0;

        currentFileIdRef.current = newId;
        setCurrentFileId(newId);
        setCurrentFileName(name);
        setSaveStatus('saved');
        setLastSavedAt(new Date());

        if (storageMode === 'local') {
          localStorage.setItem(LAST_OPENED_KEY, newId);
        }

        await refreshFiles();
      } catch (err) {
        if (opGen !== storageGenerationRef.current) {
          return;
        }
        console.error('Failed to create new drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to create drawing');
      } finally {
        if (opGen === storageGenerationRef.current) {
          setIsLoading(false);
          setTimeout(() => {
            isInitializingRef.current = false;
          }, 100);
        }
      }
    },
    [api, cancelDebouncedSave, storage, storageMode, refreshFiles]
  );

  // Rename drawing
  const renameDrawing = useCallback(
    async (fileId: string, newName: string) => {
      const opGen = storageGenerationRef.current;
      try {
        await storage.rename(fileId, newName);
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        if (fileId === currentFileIdRef.current) {
          setCurrentFileName(stripExcalidrawExtension(newName));
        }
        await refreshFiles();
      } catch (err) {
        if (opGen !== storageGenerationRef.current) {
          return;
        }
        console.error('Failed to rename drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to rename drawing');
      }
    },
    [storage, refreshFiles]
  );

  // Delete drawing
  const deleteDrawing = useCallback(
    async (fileId: string) => {
      const opGen = storageGenerationRef.current;
      try {
        await storage.delete(fileId);
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        const updatedList = await refreshFiles();
        if (opGen !== storageGenerationRef.current) {
          return;
        }

        if (fileId === currentFileIdRef.current) {
          if (updatedList.length > 0) {
            await openDrawing(updatedList[0].id);
          } else {
            await createNewDrawing('Untitled');
          }
        }
      } catch (err) {
        if (opGen !== storageGenerationRef.current) {
          return;
        }
        console.error('Failed to delete drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to delete drawing');
      }
    },
    [storage, refreshFiles, openDrawing, createNewDrawing]
  );

  // Storage transition handler: local <-> drive
  useEffect(() => {
    if (previousModeRef.current === storageMode) {
      return;
    }

    // Backend transition detected:
    // Update refs and invalidate pending async operations from old storage
    previousModeRef.current = storageMode;
    storageGenerationRef.current = generation;

    // 1. Invalidate pending debounced saves
    cancelDebouncedSave();

    // 2. Clear backend file ID (local IDs are not Drive IDs, and vice versa)
    currentFileIdRef.current = null;
    setCurrentFileId(null);

    // 3. Mark current scene as transient/unsaved in the newly active storage.
    // The current in-memory scene is preserved without overwriting!
    lastSavedContentRef.current = '';
    setSaveStatus('dirty');

    // 4. Populate sidebar with drawings from the new active backend
    refreshFiles();
  }, [storageMode, generation, cancelDebouncedSave, refreshFiles]);

  // Initial load when API is mounted for the first time
  useEffect(() => {
    if (!api || isMountedInitRef.current) return;
    isMountedInitRef.current = true;

    const opGen = storageGenerationRef.current;
    setIsLoading(true);

    async function initialize() {
      try {
        const list = await refreshFiles();
        if (opGen !== storageGenerationRef.current) return;

        const lastOpenedId = storageMode === 'local' ? localStorage.getItem(LAST_OPENED_KEY) : null;
        const targetFile = list.find((f) => f.id === lastOpenedId) || list[0];

        if (targetFile) {
          await openDrawing(targetFile.id);
        } else {
          // First-time user: initialize with default drawing
          await createNewDrawing('My First Drawing');
        }
      } finally {
        if (opGen === storageGenerationRef.current) {
          setIsLoading(false);
        }
      }
    }

    initialize();
  }, [api, storageMode, refreshFiles, openDrawing, createNewDrawing]);

  return {
    files,
    currentFileId,
    currentFileName,
    saveStatus,
    lastSavedAt,
    errorMessage,
    isLoading,
    storageMode,
    generation,
    activeStorage: storage,
    saveNow: executeSave,
    handleCanvasChange,
    openDrawing,
    createNewDrawing,
    renameDrawing,
    deleteDrawing,
    refreshFiles,
  };
}
