import { useState, useEffect, useRef, useCallback } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { CaptureUpdateAction, getSceneVersion } from '@excalidraw/excalidraw';
import type { DrawingFile, DrawingStorage, SaveStatus } from '../storage/types';
import {
  serializeDrawing,
  deserializeDrawing,
  stripExcalidrawExtension,
  createEmptyDrawing,
} from '../utils/excalidrawSerialization';
import { useDebouncedSave } from './useDebouncedSave';

const LAST_OPENED_KEY = 'canvasvault_last_opened_id';

interface UseDrawingPersistenceOptions {
  storage: DrawingStorage;
  api: ExcalidrawImperativeAPI | null;
}

export function useDrawingPersistence({ storage, api }: UseDrawingPersistenceOptions) {
  const [files, setFiles] = useState<DrawingFile[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>('Untitled');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Track the last saved serialized representation and element version
  const lastSavedContentRef = useRef<string>('');
  const lastSceneVersionRef = useRef<number>(0);
  const isInitializingRef = useRef<boolean>(true);

  const refreshFiles = useCallback(async () => {
    try {
      const list = await storage.list();
      setFiles(list);
      return list;
    } catch (err) {
      console.error('Failed to list files:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to list drawings');
      return [];
    }
  }, [storage]);

  // Actual save execution
  const executeSave = useCallback(async () => {
    if (!api) return;

    try {
      setSaveStatus('saving');
      setErrorMessage(null);

      const elements = api.getSceneElementsIncludingDeleted();
      const appState = api.getAppState();
      const binaryFiles = api.getFiles();

      const serialized = serializeDrawing(elements, appState, binaryFiles);

      let targetId = currentFileId;
      if (!targetId) {
        // Create new file
        targetId = await storage.create(currentFileName, serialized);
        setCurrentFileId(targetId);
        localStorage.setItem(LAST_OPENED_KEY, targetId);
      } else {
        // Update existing file
        await storage.update(targetId, serialized);
      }

      lastSavedContentRef.current = serialized;
      lastSceneVersionRef.current = getSceneVersion(elements);
      setLastSavedAt(new Date());
      setSaveStatus('saved');
      await refreshFiles();
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Save failed');
    }
  }, [api, currentFileId, currentFileName, storage, refreshFiles]);

  const { trigger: triggerDebouncedSave, cancel: cancelDebouncedSave } = useDebouncedSave({
    delayMs: 1500,
    onSave: executeSave,
  });

  // Called by Excalidraw onChange
  const handleCanvasChange = useCallback(
    (elements: readonly any[], _appState: any, _binaryFiles: any) => {
      if (isInitializingRef.current || !api) return;

      const currentVersion = getSceneVersion(elements);
      // If elements version changed or background changed or files changed
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
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const rawContent = await storage.get(fileId);
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
        const found = fileList.find((f) => f.id === fileId);
        const name = found ? stripExcalidrawExtension(found.name) : 'Untitled';

        setCurrentFileId(fileId);
        setCurrentFileName(name);
        setSaveStatus('saved');
        setLastSavedAt(found ? new Date(found.updatedAt) : new Date());
        localStorage.setItem(LAST_OPENED_KEY, fileId);
      } catch (err) {
        console.error('Failed to open drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to open drawing');
      } finally {
        setIsLoading(false);
        // Allow canvas change listener to resume after restoration
        setTimeout(() => {
          isInitializingRef.current = false;
        }, 100);
      }
    },
    [api, cancelDebouncedSave, storage, refreshFiles]
  );

  // Create a new blank drawing
  const createNewDrawing = useCallback(
    async (name: string = 'Untitled') => {
      if (!api) return;

      cancelDebouncedSave();
      setIsLoading(true);
      try {
        const emptyContent = createEmptyDrawing(name);
        const newId = await storage.create(name, emptyContent);

        isInitializingRef.current = true;
        api.resetScene();
        api.history.clear();

        lastSavedContentRef.current = emptyContent;
        lastSceneVersionRef.current = 0;

        setCurrentFileId(newId);
        setCurrentFileName(name);
        setSaveStatus('saved');
        setLastSavedAt(new Date());
        localStorage.setItem(LAST_OPENED_KEY, newId);

        await refreshFiles();
      } catch (err) {
        console.error('Failed to create new drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to create drawing');
      } finally {
        setIsLoading(false);
        setTimeout(() => {
          isInitializingRef.current = false;
        }, 100);
      }
    },
    [api, cancelDebouncedSave, storage, refreshFiles]
  );

  // Rename drawing
  const renameDrawing = useCallback(
    async (fileId: string, newName: string) => {
      try {
        await storage.rename(fileId, newName);
        if (fileId === currentFileId) {
          setCurrentFileName(stripExcalidrawExtension(newName));
        }
        await refreshFiles();
      } catch (err) {
        console.error('Failed to rename drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to rename drawing');
      }
    },
    [currentFileId, storage, refreshFiles]
  );

  // Delete drawing
  const deleteDrawing = useCallback(
    async (fileId: string) => {
      try {
        await storage.delete(fileId);
        const updatedList = await refreshFiles();

        if (fileId === currentFileId) {
          if (updatedList.length > 0) {
            await openDrawing(updatedList[0].id);
          } else {
            await createNewDrawing('Untitled');
          }
        }
      } catch (err) {
        console.error('Failed to delete drawing:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to delete drawing');
      }
    },
    [currentFileId, storage, refreshFiles, openDrawing, createNewDrawing]
  );

  // Initial load when API is mounted
  useEffect(() => {
    if (!api) return;

    let isMounted = true;

    async function initialize() {
      setIsLoading(true);
      const list = await refreshFiles();
      if (!isMounted) return;

      const lastOpenedId = localStorage.getItem(LAST_OPENED_KEY);
      const targetFile = list.find((f) => f.id === lastOpenedId) || list[0];

      if (targetFile) {
        await openDrawing(targetFile.id);
      } else {
        // First-time user, initialize with sample/blank
        await createNewDrawing('My First Drawing');
      }
    }

    initialize();

    return () => {
      isMounted = false;
    };
  }, [api, refreshFiles, openDrawing, createNewDrawing]);

  return {
    files,
    currentFileId,
    currentFileName,
    saveStatus,
    lastSavedAt,
    errorMessage,
    isLoading,
    saveNow: executeSave,
    handleCanvasChange,
    openDrawing,
    createNewDrawing,
    renameDrawing,
    deleteDrawing,
    refreshFiles,
  };
}
