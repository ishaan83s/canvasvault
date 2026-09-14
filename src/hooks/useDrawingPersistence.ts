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
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isOpeningFile, setIsOpeningFile] = useState<boolean>(false);
  const [isFileOperating, setIsFileOperating] = useState<boolean>(false);

  // Generation guard to prevent stale async operations from mutating state
  const storageGenerationRef = useRef<number>(generation);
  const previousModeRef = useRef<StorageMode>(storageMode);

  // Monotonic sequence guards to drop stale out-of-order async operations
  const latestLoadRequestIdRef = useRef<number>(0);
  const latestListRequestIdRef = useRef<number>(0);
  const latestSaveRequestIdRef = useRef<number>(0);
  const latestRenameRequestIdRef = useRef<number>(0);
  const latestDeleteRequestIdRef = useRef<number>(0);
  const activeSaveAbortControllerRef = useRef<AbortController | null>(null);
  const activeCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const activeRenamePromiseRef = useRef<Promise<boolean> | null>(null);
  const activeDeletePromiseRef = useRef<Promise<boolean> | null>(null);

  // Synchronous tracking of current active file ID to prevent duplicate file creations
  const currentFileIdRef = useRef<string | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const isMountedInitRef = useRef<boolean>(false);

  // Track serialized representation and element version
  const lastSavedContentRef = useRef<string>('');
  const lastSceneVersionRef = useRef<number>(0);
  const isInitializingRef = useRef<boolean>(true);

  // Refresh files scoped to current storage, generation, and list request sequence.
  // Returns null on failure so callers never misinterpret list errors as an empty file list.
  const refreshFiles = useCallback(async (): Promise<DrawingFile[] | null> => {
    const opGen = storageGenerationRef.current;
    const listRequestId = ++latestListRequestIdRef.current;
    try {
      const list = await storage.list();
      if (opGen !== storageGenerationRef.current || listRequestId !== latestListRequestIdRef.current) {
        return null;
      }
      setFiles(list);
      return list;
    } catch (err) {
      if (opGen !== storageGenerationRef.current || listRequestId !== latestListRequestIdRef.current) {
        return null;
      }
      console.error('Failed to list files:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to list drawings');
      return null;
    }
  }, [storage]);

  const activeSavePromiseRef = useRef<Promise<boolean> | null>(null);

  // Actual save execution: handles first-save vs update and never silently falls back
  const executeSave = useCallback(async (): Promise<boolean> => {
    if (!api) return false;
    if (activeSavePromiseRef.current) {
      return activeSavePromiseRef.current;
    }

    const opGen = storageGenerationRef.current;
    const saveRequestId = ++latestSaveRequestIdRef.current;
    const targetFileId = currentFileIdRef.current;
    const abortController = new AbortController();
    activeSaveAbortControllerRef.current = abortController;

    const savePromise = (async () => {
      isSavingRef.current = true;
      setIsSaving(true);

      try {
        setSaveStatus('saving');
        setErrorMessage(null);

        const elements = api.getSceneElementsIncludingDeleted();
        const appState = api.getAppState();
        const binaryFiles = api.getFiles();

        const serialized = serializeDrawing(elements, appState, binaryFiles);

        let targetId = targetFileId;
        if (
          opGen !== storageGenerationRef.current ||
          saveRequestId !== latestSaveRequestIdRef.current ||
          abortController.signal.aborted ||
          (targetFileId !== null && currentFileIdRef.current !== targetFileId)
        ) {
          return false;
        }

        if (!targetId) {
          // First save on a new/transient drawing: create exactly once
          targetId = await storage.create(currentFileName, serialized, abortController.signal);
          if (
            opGen !== storageGenerationRef.current ||
            saveRequestId !== latestSaveRequestIdRef.current ||
            abortController.signal.aborted ||
            currentFileIdRef.current !== null
          ) {
            return false;
          }

          currentFileIdRef.current = targetId;
          setCurrentFileId(targetId);
          if (storageMode === 'local') {
            localStorage.setItem(LAST_OPENED_KEY, targetId);
          }
        } else {
          // Subsequent save: update existing file
          await storage.update(targetId, serialized, abortController.signal);
          if (
            opGen !== storageGenerationRef.current ||
            saveRequestId !== latestSaveRequestIdRef.current ||
            abortController.signal.aborted ||
            currentFileIdRef.current !== targetId
          ) {
            return false;
          }
        }

        lastSavedContentRef.current = serialized;
        lastSceneVersionRef.current = getSceneVersion(elements);
        setLastSavedAt(new Date());
        setSaveStatus('saved');
        await refreshFiles();
        return (
          opGen === storageGenerationRef.current &&
          saveRequestId === latestSaveRequestIdRef.current &&
          !abortController.signal.aborted
        );
      } catch (err) {
        if (
          opGen === storageGenerationRef.current &&
          saveRequestId === latestSaveRequestIdRef.current &&
          !abortController.signal.aborted &&
          (targetFileId === null ? currentFileIdRef.current === null : currentFileIdRef.current === targetFileId)
        ) {
          console.error('Save failed:', err);
          setSaveStatus('error');
          setErrorMessage(err instanceof Error ? err.message : 'Save failed');
        }
        // Zero silent fallback to LocalStorage! Scene remains in-memory dirty for manual retry.
        return false;
      } finally {
        if (activeSaveAbortControllerRef.current === abortController) {
          activeSaveAbortControllerRef.current = null;
        }
        if (
          opGen === storageGenerationRef.current &&
          saveRequestId === latestSaveRequestIdRef.current &&
          !abortController.signal.aborted
        ) {
          isSavingRef.current = false;
          setIsSaving(false);
          activeSavePromiseRef.current = null;
        }
      }
    })();

    activeSavePromiseRef.current = savePromise;
    return savePromise;
  }, [api, currentFileName, storage, storageMode, refreshFiles]);

  const { trigger: triggerDebouncedSave, cancel: cancelDebouncedSave, isDebouncing } = useDebouncedSave({
    delayMs: 1500,
    onSave: async () => {
      await executeSave();
    },
  });

  const cancelPendingSave = useCallback(() => {
    cancelDebouncedSave();
    latestSaveRequestIdRef.current++;
    if (activeSaveAbortControllerRef.current) {
      activeSaveAbortControllerRef.current.abort();
      activeSaveAbortControllerRef.current = null;
    }
    activeSavePromiseRef.current = null;
    isSavingRef.current = false;
    setIsSaving(false);
  }, [cancelDebouncedSave]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    cancelDebouncedSave();
    return executeSave();
  }, [cancelDebouncedSave, executeSave]);

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

  // Open a specific drawing with monotonic sequence tracking
  const openDrawing = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (!api) return false;

      cancelPendingSave();
      const opGen = storageGenerationRef.current;
      const loadRequestId = ++latestLoadRequestIdRef.current;
      setIsLoading(true);
      setIsOpeningFile(true);
      setErrorMessage(null);

      try {
        const rawContent = await storage.get(fileId);
        if (opGen !== storageGenerationRef.current || loadRequestId !== latestLoadRequestIdRef.current) {
          return false;
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
        if (opGen !== storageGenerationRef.current || loadRequestId !== latestLoadRequestIdRef.current) {
          return false;
        }

        const found = fileList ? fileList.find((f) => f.id === fileId) : undefined;
        const name = found ? stripExcalidrawExtension(found.name) : 'Untitled';

        currentFileIdRef.current = fileId;
        setCurrentFileId(fileId);
        setCurrentFileName(name);
        setSaveStatus('saved');
        setLastSavedAt(found ? new Date(found.updatedAt) : new Date());

        if (storageMode === 'local') {
          localStorage.setItem(LAST_OPENED_KEY, fileId);
        }
        return true;
      } catch (err) {
        if (opGen !== storageGenerationRef.current || loadRequestId !== latestLoadRequestIdRef.current) {
          return false;
        }
        console.error('Failed to open drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to open drawing');
        return false;
      } finally {
        if (opGen === storageGenerationRef.current && loadRequestId === latestLoadRequestIdRef.current) {
          setIsLoading(false);
          setIsOpeningFile(false);
          setTimeout(() => {
            isInitializingRef.current = false;
          }, 100);
        }
      }
    },
    [api, cancelPendingSave, storage, storageMode, refreshFiles]
  );

  // Create a new blank drawing with concurrency deduplication
  const createNewDrawing = useCallback(
    async (name: string = 'Untitled'): Promise<string | null> => {
      if (!api) return null;
      if (activeCreatePromiseRef.current) {
        return activeCreatePromiseRef.current;
      }

      cancelPendingSave();
      const opGen = storageGenerationRef.current;
      const loadRequestId = ++latestLoadRequestIdRef.current;
      setIsLoading(true);
      setIsFileOperating(true);

      const createPromise = (async (): Promise<string | null> => {
        try {
          const emptyContent = createEmptyDrawing(name);
          const newId = await storage.create(name, emptyContent);
          if (opGen !== storageGenerationRef.current || loadRequestId !== latestLoadRequestIdRef.current) {
            return null;
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
          return newId;
        } catch (err) {
          if (opGen !== storageGenerationRef.current || loadRequestId !== latestLoadRequestIdRef.current) {
            return null;
          }
          console.error('Failed to create new drawing:', err);
          setErrorMessage(err instanceof Error ? err.message : 'Failed to create drawing');
          return null;
        } finally {
          activeCreatePromiseRef.current = null;
          if (opGen === storageGenerationRef.current && loadRequestId === latestLoadRequestIdRef.current) {
            setIsLoading(false);
            setIsFileOperating(false);
            setTimeout(() => {
              isInitializingRef.current = false;
            }, 100);
          }
        }
      })();

      activeCreatePromiseRef.current = createPromise;
      return createPromise;
    },
    [api, cancelPendingSave, storage, storageMode, refreshFiles]
  );

  // Helper to reset active scene to clean blank transient Untitled state
  const resetToCleanBlankState = useCallback(() => {
    currentFileIdRef.current = null;
    setCurrentFileId(null);
    setCurrentFileName('Untitled');
    lastSavedContentRef.current = '';
    lastSceneVersionRef.current = 0;
    if (api) {
      isInitializingRef.current = true;
      api.resetScene();
      api.history.clear();
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }
    setSaveStatus('saved');
    if (storageMode === 'local') {
      localStorage.removeItem(LAST_OPENED_KEY);
    }
  }, [api, storageMode]);

  // Rename drawing with operation status tracking, request sequencing, and transient drawing support
  const renameDrawing = useCallback(
    async (fileId: string | null, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      const safeDisplayName = stripExcalidrawExtension(trimmed || 'Untitled');

      // Transient drawing rename: active drawing has not been persisted yet (currentFileId is null)
      if (fileId === null || (fileId === currentFileIdRef.current && currentFileIdRef.current === null)) {
        setCurrentFileName(safeDisplayName);
        return true;
      }

      if (activeRenamePromiseRef.current) {
        return activeRenamePromiseRef.current;
      }

      const opGen = storageGenerationRef.current;
      const renameRequestId = ++latestRenameRequestIdRef.current;
      setIsFileOperating(true);

      const renamePromise = (async (): Promise<boolean> => {
        try {
          await storage.rename(fileId, newName);
          if (opGen !== storageGenerationRef.current || renameRequestId !== latestRenameRequestIdRef.current) {
            return false;
          }

          if (fileId === currentFileIdRef.current) {
            setCurrentFileName(safeDisplayName);
          }
          await refreshFiles();
          return (
            opGen === storageGenerationRef.current &&
            renameRequestId === latestRenameRequestIdRef.current
          );
        } catch (err) {
          if (opGen !== storageGenerationRef.current || renameRequestId !== latestRenameRequestIdRef.current) {
            return false;
          }
          console.error('Failed to rename drawing:', err);
          setErrorMessage(err instanceof Error ? err.message : 'Failed to rename drawing');
          return false;
        } finally {
          activeRenamePromiseRef.current = null;
          if (opGen === storageGenerationRef.current && renameRequestId === latestRenameRequestIdRef.current) {
            setIsFileOperating(false);
          }
        }
      })();

      activeRenamePromiseRef.current = renamePromise;
      return renamePromise;
    },
    [storage, refreshFiles]
  );

  // Delete drawing with operation status tracking, inactive save isolation, and explicit fallback semantics
  const deleteDrawing = useCallback(
    async (fileId: string): Promise<boolean> => {
      if (activeDeletePromiseRef.current) {
        return activeDeletePromiseRef.current;
      }

      const isActive = fileId === currentFileIdRef.current;

      // 1. Inactive delete must NOT cancel active-file saves! Only cancel when deleting active file.
      if (isActive) {
        cancelPendingSave();
      }

      const opGen = storageGenerationRef.current;
      const deleteRequestId = ++latestDeleteRequestIdRef.current;
      setIsFileOperating(true);

      const deletePromise = (async (): Promise<boolean> => {
        try {
          await storage.delete(fileId);
          if (opGen !== storageGenerationRef.current || deleteRequestId !== latestDeleteRequestIdRef.current) {
            return false;
          }

          // 2. Safe active-file deletion: purge active identity immediately upon deletion
          if (isActive) {
            currentFileIdRef.current = null;
            setCurrentFileId(null);
            lastSavedContentRef.current = '';
            lastSceneVersionRef.current = 0;
            if (storageMode === 'local') {
              localStorage.removeItem(LAST_OPENED_KEY);
            }
          }

          const updatedList = await refreshFiles();
          if (opGen !== storageGenerationRef.current || deleteRequestId !== latestDeleteRequestIdRef.current) {
            return false;
          }

          // 3. Fallback semantics when active file was deleted:
          if (isActive) {
            if (updatedList === null) {
              // Active delete -> list failure: NEVER create replacement! Clean blank state + error
              resetToCleanBlankState();
              setErrorMessage((prev) => prev || 'Failed to refresh file list after delete');
              return true;
            }

            if (updatedList.length > 0) {
              // Active delete -> non-empty list: open fallback
              const opened = await openDrawing(updatedList[0].id);
              if (!opened || currentFileIdRef.current === null) {
                // Active delete -> fallback open failure: NEVER retain deleted ID! Clean blank state + error
                resetToCleanBlankState();
                setErrorMessage((prev) => prev || 'Failed to open fallback drawing after delete');
              }
            } else {
              // Active delete -> empty list: create replacement for final remaining file
              const newId = await createNewDrawing('Untitled');
              if (!newId) {
                // Active delete -> replacement creation failure: currentFileId remains null
                resetToCleanBlankState();
              }
            }
          }

          return true;
        } catch (err) {
          if (opGen !== storageGenerationRef.current || deleteRequestId !== latestDeleteRequestIdRef.current) {
            return false;
          }
          console.error('Failed to delete drawing:', err);
          setErrorMessage(err instanceof Error ? err.message : 'Failed to delete drawing');
          return false;
        } finally {
          activeDeletePromiseRef.current = null;
          if (opGen === storageGenerationRef.current && deleteRequestId === latestDeleteRequestIdRef.current) {
            setIsFileOperating(false);
          }
        }
      })();

      activeDeletePromiseRef.current = deletePromise;
      return deletePromise;
    },
    [api, cancelPendingSave, storage, storageMode, refreshFiles, openDrawing, createNewDrawing, resetToCleanBlankState]
  );

  const discardUnsavedDriveChanges = useCallback(async () => {
    cancelPendingSave();
    if (!api) return;

    try {
      const localList = await selection.localStorage.list();
      const lastOpenedId = localStorage.getItem(LAST_OPENED_KEY);
      const targetFile = localList.find((f) => f.id === lastOpenedId) || localList[0];

      if (targetFile) {
        const rawContent = await selection.localStorage.get(targetFile.id);
        const restored = deserializeDrawing(rawContent);

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
        isInitializingRef.current = false;

        currentFileIdRef.current = targetFile.id;
        setCurrentFileId(targetFile.id);
        setCurrentFileName(stripExcalidrawExtension(targetFile.name));
        lastSavedContentRef.current = rawContent;
        lastSceneVersionRef.current = getSceneVersion(restored.elements);
        setSaveStatus('saved');
        return;
      }
    } catch (err) {
      console.warn('Failed to restore local drawing on discard:', err);
    }

    isInitializingRef.current = true;
    api.resetScene();
    api.history.clear();
    isInitializingRef.current = false;

    currentFileIdRef.current = null;
    setCurrentFileId(null);
    setCurrentFileName('Untitled');
    lastSavedContentRef.current = '';
    lastSceneVersionRef.current = 0;
    setSaveStatus('saved');
  }, [api, cancelPendingSave, selection.localStorage]);

  // Storage transition handler: local <-> drive
  useEffect(() => {
    if (previousModeRef.current === storageMode) {
      return;
    }

    const prevMode = previousModeRef.current;
    previousModeRef.current = storageMode;
    storageGenerationRef.current = generation;

    // 1. Invalidate pending debounced saves and in-flight saves
    cancelPendingSave();

    // 2. Invalidate any in-flight load requests or create requests from previous mode
    latestLoadRequestIdRef.current++;
    latestListRequestIdRef.current++;
    activeCreatePromiseRef.current = null;
    setIsOpeningFile(false);
    setIsFileOperating(false);

    if (prevMode === 'drive' && storageMode === 'local') {
      // Transition from Drive to Local (sign-out):
      // Cleanly restore LocalStorage workspace so Drive content cannot leak into LocalStorage
      (async () => {
        try {
          const localList = await refreshFiles();
          if (storageGenerationRef.current !== generation || localList === null) return;

          const lastOpenedId = localStorage.getItem(LAST_OPENED_KEY);
          const targetFile = localList.find((f) => f.id === lastOpenedId) || localList[0];
          if (targetFile) {
            await openDrawing(targetFile.id);
          } else {
            await createNewDrawing('My First Drawing');
          }
        } catch (err) {
          console.warn('Failed to restore local workspace on sign-out transition:', err);
        }
      })();
      return;
    }

    // Transition from Local to Drive (sign-in):
    // 3. Clear backend file ID (local IDs are not Drive IDs, and vice versa)
    currentFileIdRef.current = null;
    setCurrentFileId(null);

    // 4. Mark current scene as transient/unsaved in the newly active storage.
    // The current in-memory scene is preserved without overwriting!
    lastSavedContentRef.current = '';
    setSaveStatus('dirty');

    // 5. Populate sidebar with drawings from the new active backend
    refreshFiles();
  }, [storageMode, generation, cancelPendingSave, refreshFiles, openDrawing, createNewDrawing]);

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
        if (list === null) {
          // List request failed on initial startup (e.g. Drive network failure / token issue)
          // Do NOT interpret as empty list or create new drawing!
          return;
        }

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

  const isFileActionLocked = isFileOperating || isOpeningFile || isLoading;

  return {
    files,
    currentFileId,
    currentFileName,
    saveStatus,
    isDirty: saveStatus === 'dirty',
    isSaving,
    isDebouncing,
    isOpeningFile,
    isFileOperating,
    isFileActionLocked,
    isSignOutSafe:
      storageMode !== 'drive' ||
      (!isSaving && !isDebouncing && !isOpeningFile && !isFileOperating && saveStatus !== 'dirty' && saveStatus !== 'error' && saveStatus !== 'saving'),
    lastSavedAt,
    errorMessage,
    isLoading,
    storageMode,
    generation,
    activeStorage: storage,
    driveAdapter: selection.driveAdapter,
    saveNow,
    cancelPendingSave,
    discardUnsavedDriveChanges,
    handleCanvasChange,
    openDrawing,
    createNewDrawing,
    renameDrawing,
    deleteDrawing,
    refreshFiles,
  };
}
