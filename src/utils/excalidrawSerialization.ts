import {
  serializeAsJSON,
  restore,
} from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
} from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types';

export type RestoredScene = ReturnType<typeof restore>;

export const EXCALIDRAW_EXTENSION = '.excalidraw';

/**
 * Ensures the filename ends with the .excalidraw extension.
 */
export function ensureExcalidrawExtension(name: string): string {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().endsWith(EXCALIDRAW_EXTENSION)) {
    return trimmed;
  }
  return `${trimmed}${EXCALIDRAW_EXTENSION}`;
}

/**
 * Strips the .excalidraw extension for display purposes.
 */
export function stripExcalidrawExtension(name: string): string {
  if (name.toLowerCase().endsWith(EXCALIDRAW_EXTENSION)) {
    return name.slice(0, -EXCALIDRAW_EXTENSION.length);
  }
  return name;
}

/**
 * Validates whether parsed JSON represents an Excalidraw drawing.
 */
export function isValidExcalidrawJson(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  // Valid Excalidraw files have type === 'excalidraw' or have an elements array
  return (
    candidate.type === 'excalidraw' ||
    Array.isArray(candidate.elements)
  );
}

/**
 * Serializes elements, appState, and files into native Excalidraw JSON.
 * We pass "local" to ensure that embedded files and appState are retained.
 */
export function serializeDrawing(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles = {}
): string {
  return serializeAsJSON(elements, appState, files, 'local');
}

/**
 * Deserializes an Excalidraw JSON string, validating the schema and restoring
 * elements, appState, and files via official Excalidraw restore APIs.
 */
export function deserializeDrawing(jsonContent: string): RestoredScene {
  if (!jsonContent || !jsonContent.trim()) {
    throw new Error('Drawing content is empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (err) {
    throw new Error(`Failed to parse drawing JSON: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
  }

  if (!isValidExcalidrawJson(parsed)) {
    throw new Error('Invalid Excalidraw file format: missing required elements or excalidraw type');
  }

  const restored = restore(parsed as any, null, null);
  return restored;
}

/**
 * Generates initial empty drawing content.
 */
export function createEmptyDrawing(name: string = 'Untitled'): string {
  return serializeDrawing([], { name }, {});
}
