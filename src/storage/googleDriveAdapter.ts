import type { DrawingFile, DrawingStorage } from './types';
import {
  ensureExcalidrawExtension,
  isValidExcalidrawJson,
} from '../utils/excalidrawSerialization';
import { GoogleDriveError } from './googleDriveErrors';
import {
  GoogleDriveClient,
  type GoogleDriveClientOptions,
} from './googleDriveClient';

export interface GoogleDriveAdapterOptions extends GoogleDriveClientOptions {}

/**
 * Production-conscious Google Drive adapter implementing DrawingStorage.
 * Stores native .excalidraw JSON files in the authenticated user's own Drive under CanvasVault/.
 */
export class GoogleDriveAdapter implements DrawingStorage {
  public readonly client: GoogleDriveClient;

  constructor(options: GoogleDriveAdapterOptions) {
    this.client = new GoogleDriveClient(options);
  }

  /**
   * Validates that content is non-empty and conforms to valid Excalidraw JSON.
   */
  private assertValidDrawingContent(content: string): void {
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new GoogleDriveError('INVALID_CONTENT', 'Drawing content cannot be empty.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new GoogleDriveError('INVALID_CONTENT', 'Drawing content is not valid JSON.');
    }

    if (!isValidExcalidrawJson(parsed)) {
      throw new GoogleDriveError(
        'INVALID_CONTENT',
        'Drawing JSON does not match required Excalidraw schema.'
      );
    }
  }

  /**
   * Creates a new drawing file in the CanvasVault folder via multipart upload.
   * Returns the Google Drive file ID.
   */
  async create(name: string, content: string): Promise<string> {
    this.assertValidDrawingContent(content);
    const safeName = ensureExcalidrawExtension(name || 'Untitled');

    const file = await this.client.createMultipartFile(safeName, content);
    return file.id;
  }

  /**
   * Creates a new drawing file with optional additive appProperties (e.g. migration markers).
   * Does not bypass validation, extension checks, or mandatory CanvasVault ownership markers.
   */
  async createWithProperties(
    name: string,
    content: string,
    extraAppProperties?: Record<string, string>
  ): Promise<string> {
    this.assertValidDrawingContent(content);
    const safeName = ensureExcalidrawExtension(name || 'Untitled');

    const file = await this.client.createMultipartFile(safeName, content, extraAppProperties);
    return file.id;
  }

  /**
   * Updates an existing drawing file's content in-place.
   * Enforces centralized ownership validation before mutation.
   */
  async update(fileId: string, content: string): Promise<void> {
    this.assertValidDrawingContent(content);
    await this.client.updateMediaFile(fileId, content);
  }

  /**
   * Retrieves raw drawing content from Google Drive.
   * Validates ownership and asserts content integrity before returning.
   */
  async get(fileId: string): Promise<string> {
    const content = await this.client.downloadMediaFile(fileId);
    this.assertValidDrawingContent(content);
    return content;
  }

  /**
   * Lists drawing files within the CanvasVault folder.
   * Returns files conforming to the DrawingFile interface, sorted newest modified first.
   */
  async list(): Promise<DrawingFile[]> {
    const files = await this.client.listManagedFiles();

    return files.map((file) => ({
      id: file.id,
      name: file.name,
      createdAt: file.createdTime || new Date().toISOString(),
      updatedAt: file.modifiedTime || new Date().toISOString(),
      size: file.size ? Number(file.size) : undefined,
    }));
  }

  /**
   * Renames an existing drawing file in Google Drive.
   * Automatically enforces the .excalidraw extension.
   */
  async rename(fileId: string, name: string): Promise<void> {
    const safeName = ensureExcalidrawExtension(name.trim() || 'Untitled');
    await this.client.renameFile(fileId, safeName);
  }

  /**
   * Deletes an existing drawing file from Google Drive.
   * Enforces centralized ownership validation before deletion.
   */
  async delete(fileId: string): Promise<void> {
    await this.client.deleteFile(fileId);
  }
}
