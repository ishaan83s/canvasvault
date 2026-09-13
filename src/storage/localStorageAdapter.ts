import type { DrawingFile, DrawingStorage } from './types';
import { ensureExcalidrawExtension } from '../utils/excalidrawSerialization';

const FILES_INDEX_KEY = 'canvasvault_test_files_index';
const FILE_CONTENT_PREFIX = 'canvasvault_test_content_';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class LocalStorageAdapter implements DrawingStorage {
  private getIndex(): DrawingFile[] {
    try {
      const raw = localStorage.getItem(FILES_INDEX_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as DrawingFile[];
    } catch {
      return [];
    }
  }

  private saveIndex(index: DrawingFile[]): void {
    localStorage.setItem(FILES_INDEX_KEY, JSON.stringify(index));
  }

  async list(): Promise<DrawingFile[]> {
    const files = this.getIndex();
    // Return sorted newest updated first
    return files.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async get(fileId: string): Promise<string> {
    const content = localStorage.getItem(`${FILE_CONTENT_PREFIX}${fileId}`);
    if (content === null) {
      throw new Error(`Drawing not found: ${fileId}`);
    }
    return content;
  }

  async create(name: string, content: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new Error('Save operation aborted');
    }
    const safeName = ensureExcalidrawExtension(name || 'Untitled');
    const id = generateId();
    const now = new Date().toISOString();

    const newFile: DrawingFile = {
      id,
      name: safeName,
      createdAt: now,
      updatedAt: now,
      size: new Blob([content]).size,
    };

    const files = this.getIndex();
    files.unshift(newFile);
    this.saveIndex(files);

    localStorage.setItem(`${FILE_CONTENT_PREFIX}${id}`, content);
    return id;
  }

  async update(fileId: string, content: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error('Save operation aborted');
    }
    const files = this.getIndex();
    const fileIndex = files.findIndex((f) => f.id === fileId);
    if (fileIndex === -1) {
      throw new Error(`Drawing file with ID ${fileId} not found`);
    }

    const now = new Date().toISOString();
    files[fileIndex].updatedAt = now;
    files[fileIndex].size = new Blob([content]).size;
    this.saveIndex(files);

    localStorage.setItem(`${FILE_CONTENT_PREFIX}${fileId}`, content);
  }

  async rename(fileId: string, name: string): Promise<void> {
    const files = this.getIndex();
    const fileIndex = files.findIndex((f) => f.id === fileId);
    if (fileIndex === -1) {
      throw new Error(`Drawing file with ID ${fileId} not found`);
    }

    const safeName = ensureExcalidrawExtension(name.trim() || 'Untitled');
    files[fileIndex].name = safeName;
    files[fileIndex].updatedAt = new Date().toISOString();
    this.saveIndex(files);
  }

  async delete(fileId: string): Promise<void> {
    const files = this.getIndex();
    const updated = files.filter((f) => f.id !== fileId);
    this.saveIndex(updated);

    localStorage.removeItem(`${FILE_CONTENT_PREFIX}${fileId}`);
  }
}

export const testLocalStorageAdapter = new LocalStorageAdapter();
