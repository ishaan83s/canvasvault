import {
  GoogleDriveError,
  createGoogleDriveErrorFromStatus,
} from './googleDriveErrors';

export interface DriveFileMetadata {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface GoogleDriveClientOptions {
  getToken: () => string | Promise<string | null> | null;
  fetchFn?: typeof fetch;
  folderName?: string;
}

export const CANVASVAULT_APP_KEY = 'canvasvault';
export const CANVASVAULT_ROOT_FOLDER_TYPE = 'root_folder';
export const CANVASVAULT_DRAWING_TYPE = 'drawing';
export const DEFAULT_FOLDER_NAME = 'CanvasVault';

/**
 * Escapes characters in Drive API 'q' expression string literals.
 * Backslashes (\) and single quotes (') must be escaped with a backslash.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Low-level Google Drive API v3 HTTP client.
 * Enforces appProperties scoping, safe query construction, and fail-closed validation.
 */
export class GoogleDriveClient {
  private readonly getToken: () => string | Promise<string | null> | null;
  private readonly fetch: typeof fetch;
  public readonly folderName: string;

  private cachedFolderId: string | null = null;
  private folderDiscoveryPromise: Promise<string> | null = null;

  constructor(options: GoogleDriveClientOptions) {
    this.getToken = options.getToken;
    this.fetch = options.fetchFn || (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
    this.folderName = options.folderName || DEFAULT_FOLDER_NAME;
  }

  /**
   * Retrieves active access token from the provider.
   * Throws typed GoogleDriveError if missing or empty.
   */
  private async getValidToken(): Promise<string> {
    let token: string | null = null;
    try {
      token = await this.getToken();
    } catch {
      throw new GoogleDriveError('MISSING_TOKEN');
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new GoogleDriveError('MISSING_TOKEN');
    }

    return token.trim();
  }

  /**
   * Executes an authenticated fetch request against Google Drive APIs.
   * Redacts sensitive Authorization headers and response details on failure.
   */
  private async authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getValidToken();

    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers,
      });
    } catch (err) {
      if (err instanceof GoogleDriveError) {
        throw err;
      }
      throw new GoogleDriveError('NETWORK_ERROR', undefined);
    }

    if (!response.ok) {
      throw createGoogleDriveErrorFromStatus(response.status, response.statusText);
    }

    return response;
  }

  /**
   * Discovers the existing CanvasVault folder or creates it if not found.
   * Guaranteed to check both name, mimeType, and CanvasVault appProperties marker.
   * Uses single-flight promise to prevent concurrent creation races.
   */
  async getOrCreateFolder(): Promise<string> {
    if (this.cachedFolderId) {
      return this.cachedFolderId;
    }

    if (this.folderDiscoveryPromise) {
      return this.folderDiscoveryPromise;
    }

    this.folderDiscoveryPromise = (async () => {
      try {
        const folderId = await this.discoverFolder();
        if (folderId) {
          this.cachedFolderId = folderId;
          return folderId;
        }

        const newFolderId = await this.createFolder();
        this.cachedFolderId = newFolderId;
        return newFolderId;
      } finally {
        this.folderDiscoveryPromise = null;
      }
    })();

    return this.folderDiscoveryPromise;
  }

  /**
   * Searches for the CanvasVault root folder strictly scoped by appProperties marker.
   */
  private async discoverFolder(): Promise<string | null> {
    const escapedName = escapeDriveQueryValue(this.folderName);
    const qParts = [
      "mimeType = 'application/vnd.google-apps.folder'",
      `name = '${escapedName}'`,
      'trashed = false',
      `appProperties has { key='app' and value='${CANVASVAULT_APP_KEY}' }`,
      `appProperties has { key='type' and value='${CANVASVAULT_ROOT_FOLDER_TYPE}' }`,
    ];

    const params = new URLSearchParams({
      q: qParts.join(' and '),
      fields: 'files(id, name, createdTime, appProperties)',
      orderBy: 'createdTime asc',
      pageSize: '10',
    });

    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`
    );

    let data: { files?: DriveFileMetadata[] };
    try {
      data = await response.json();
    } catch {
      throw new GoogleDriveError('MALFORMED_RESPONSE');
    }

    if (Array.isArray(data.files) && data.files.length > 0 && data.files[0].id) {
      return data.files[0].id;
    }

    return null;
  }

  /**
   * Creates the CanvasVault root folder with required appProperties markers.
   */
  private async createFolder(): Promise<string> {
    const body = {
      name: this.folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'CanvasVault drawing folder',
      appProperties: {
        app: CANVASVAULT_APP_KEY,
        type: CANVASVAULT_ROOT_FOLDER_TYPE,
      },
    };

    const response = await this.authenticatedFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let data: DriveFileMetadata;
    try {
      data = await response.json();
    } catch {
      throw new GoogleDriveError('MALFORMED_RESPONSE');
    }

    if (!data || !data.id) {
      throw new GoogleDriveError('MALFORMED_RESPONSE', 'Folder creation did not return a valid folder ID');
    }

    return data.id;
  }

  /**
   * Shared centralized validation for file ownership and scope.
   * Rejects arbitrary file IDs, trashed files, files outside CanvasVault folder,
   * or files lacking the CanvasVault drawing marker.
   */
  async validateManagedFile(fileId: string): Promise<DriveFileMetadata> {
    if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
      throw new Error(`Drawing not found: ${fileId}`);
    }

    const folderId = await this.getOrCreateFolder();

    const params = new URLSearchParams({
      fields: 'id, name, parents, trashed, appProperties, createdTime, modifiedTime, size',
    });

    let response: Response;
    try {
      response = await this.authenticatedFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`
      );
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'NOT_FOUND') {
        throw new Error(`Drawing not found: ${fileId}`);
      }
      throw err;
    }

    let data: DriveFileMetadata;
    try {
      data = await response.json();
    } catch {
      throw new GoogleDriveError('MALFORMED_RESPONSE');
    }

    // Must exist, not be trashed, belong to CanvasVault folder, and have drawing marker
    const isTrashed = data.trashed === true;
    const isUnderFolder = Array.isArray(data.parents) && data.parents.includes(folderId);
    const hasMarker =
      data.appProperties?.app === CANVASVAULT_APP_KEY &&
      data.appProperties?.type === CANVASVAULT_DRAWING_TYPE;

    if (isTrashed || !isUnderFolder || !hasMarker) {
      throw new Error(`Drawing not found: ${fileId}`);
    }

    return data;
  }

  /**
   * Uploads a new drawing file via Drive API v3 multipart upload.
   */
  async createMultipartFile(
    name: string,
    content: string,
    extraAppProperties?: Record<string, string>
  ): Promise<DriveFileMetadata> {
    const folderId = await this.getOrCreateFolder();
    const boundary = `CanvasVaultBoundary${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const appProperties = {
      ...extraAppProperties,
      app: CANVASVAULT_APP_KEY,
      type: CANVASVAULT_DRAWING_TYPE,
    };

    const metadata = {
      name,
      parents: [folderId],
      mimeType: 'application/json',
      appProperties,
    };

    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    let response: Response;
    try {
      response = await this.authenticatedFetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'NOT_FOUND') {
        this.invalidateFolderCache();
      }
      throw err;
    }

    let data: DriveFileMetadata;
    try {
      data = await response.json();
    } catch {
      throw new GoogleDriveError('MALFORMED_RESPONSE');
    }

    if (!data || !data.id) {
      throw new GoogleDriveError('MALFORMED_RESPONSE', 'File upload did not return a valid file ID');
    }

    return data;
  }

  /**
   * Updates an existing drawing file's content in-place via media upload.
   */
  async updateMediaFile(fileId: string, content: string): Promise<void> {
    // Validates managed ownership prior to mutation
    await this.validateManagedFile(fileId);

    await this.authenticatedFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: content,
      }
    );
  }

  /**
   * Downloads raw drawing content string from Google Drive.
   */
  async downloadMediaFile(fileId: string): Promise<string> {
    // Validates managed ownership prior to read
    await this.validateManagedFile(fileId);

    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    );

    return response.text();
  }

  /**
   * Lists drawing files within the CanvasVault folder.
   * Strictly filtered by parent folder, non-trashed, and drawing appProperties.
   */
  async listManagedFiles(): Promise<DriveFileMetadata[]> {
    const folderId = await this.getOrCreateFolder();
    const escapedFolderId = escapeDriveQueryValue(folderId);

    const qParts = [
      `'${escapedFolderId}' in parents`,
      'trashed = false',
      `appProperties has { key='app' and value='${CANVASVAULT_APP_KEY}' }`,
      `appProperties has { key='type' and value='${CANVASVAULT_DRAWING_TYPE}' }`,
    ];

    const params = new URLSearchParams({
      q: qParts.join(' and '),
      fields: 'files(id, name, createdTime, modifiedTime, size, trashed, appProperties)',
      orderBy: 'modifiedTime desc',
      pageSize: '100',
    });

    let response: Response;
    try {
      response = await this.authenticatedFetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`
      );
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'NOT_FOUND') {
        this.invalidateFolderCache();
      }
      throw err;
    }

    let data: { files?: DriveFileMetadata[] };
    try {
      data = await response.json();
    } catch {
      throw new GoogleDriveError('MALFORMED_RESPONSE');
    }

    return Array.isArray(data.files) ? data.files : [];
  }

  /**
   * Renames an existing drawing file metadata.
   */
  async renameFile(fileId: string, newName: string): Promise<void> {
    // Validates managed ownership prior to mutation
    await this.validateManagedFile(fileId);

    await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      }
    );
  }

  /**
   * Permanently deletes a managed drawing file from Google Drive.
   */
  async deleteFile(fileId: string): Promise<void> {
    // Validates managed ownership prior to mutation
    await this.validateManagedFile(fileId);

    await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Invalidates the in-memory cached folder ID so the next folder resolution
   * discovers or recreates the managed CanvasVault folder.
   */
  invalidateFolderCache(): void {
    this.cachedFolderId = null;
  }

  /**
   * Alias for backwards compatibility and explicit reset.
   */
  clearCachedFolderId(): void {
    this.invalidateFolderCache();
  }
}
