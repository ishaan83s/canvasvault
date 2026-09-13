export interface DrawingFile {
  id: string;
  name: string; // e.g., "Architecture.excalidraw"
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  size?: number; // size in bytes
}

export interface DrawingStorage {
  create(name: string, content: string): Promise<string>;
  update(fileId: string, content: string): Promise<void>;
  get(fileId: string): Promise<string>;
  list(): Promise<DrawingFile[]>;
  rename(fileId: string, name: string): Promise<void>;
  delete(fileId: string): Promise<void>;
}

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

export type { StorageMode, AuthMode } from './storageMode';
