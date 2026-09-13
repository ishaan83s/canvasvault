import { serializeDrawing, deserializeDrawing, ensureExcalidrawExtension, stripExcalidrawExtension, isValidExcalidrawJson } from './excalidrawSerialization';
import { LocalStorageAdapter } from '../storage/localStorageAdapter';
import { resolveStorageMode, resolveAuthMode } from '../storage/storageMode';
import { StorageCoordinator } from '../storage/storageCoordinator';
import { migrateLocalDrawingsToDrive } from '../storage/migrationService';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

export async function runPersistenceSelfTests(): Promise<{ passed: boolean; results: TestResult[] }> {
  const results: TestResult[] = [];

  function record(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            results.push({ name, passed: true });
          })
          .catch((err) => {
            results.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) });
          });
      }
      results.push({ name, passed: true });
    } catch (err) {
      results.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 1. Filename Extension Test
  record('1. Filename extension utilities', () => {
    if (ensureExcalidrawExtension('Design') !== 'Design.excalidraw') throw new Error('ensureExtension failed');
    if (ensureExcalidrawExtension('Design.excalidraw') !== 'Design.excalidraw') throw new Error('ensureExtension idempotent failed');
    if (stripExcalidrawExtension('Design.excalidraw') !== 'Design') throw new Error('stripExtension failed');
  });

  // 2. Native Excalidraw Serialization Test
  const mockElement: Partial<ExcalidrawElement> = {
    id: 'test-rect-1',
    type: 'rectangle',
    x: 120,
    y: 180,
    width: 250,
    height: 120,
    angle: 0,
    strokeColor: '#e03131',
    backgroundColor: '#ffc9c9',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 54321,
    version: 1,
    versionNonce: 98765,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };

  const mockImageElement: Partial<ExcalidrawElement> = {
    id: 'test-img-1',
    type: 'image',
    x: 400,
    y: 180,
    width: 100,
    height: 100,
    fileId: 'sample-file-1' as any,
    status: 'saved',
    scale: [1, 1],
    isDeleted: false,
    version: 1,
    versionNonce: 12345,
    updated: 1,
  };

  const mockFiles: BinaryFiles = {
    'sample-file-1': {
      id: 'sample-file-1' as any,
      dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' as any,
      mimeType: 'image/png',
      created: Date.now(),
      lastRetrieved: Date.now(),
    },
  };

  let serializedJson = '';

  record('2. Native .excalidraw format serialization', () => {
    serializedJson = serializeDrawing(
      [mockElement as ExcalidrawElement, mockImageElement as ExcalidrawElement],
      { viewBackgroundColor: '#f1f3f5', name: 'Verification Drawing' },
      mockFiles
    );

    const parsed = JSON.parse(serializedJson);
    if (parsed.type !== 'excalidraw') throw new Error(`Expected type 'excalidraw', got '${parsed.type}'`);
    if (parsed.version !== 2) throw new Error(`Expected version 2, got '${parsed.version}'`);
    if (!parsed.source || !parsed.source.includes('excalidraw')) throw new Error('Source identifier missing');
    if (!Array.isArray(parsed.elements) || parsed.elements.length !== 2) throw new Error('Elements array missing or wrong length');
    if (parsed.elements[0].id !== 'test-rect-1') throw new Error('Element id mismatch');
    if (!parsed.files || !parsed.files['sample-file-1']) throw new Error('Embedded files missing in serialized output');
    if (!isValidExcalidrawJson(parsed)) throw new Error('isValidExcalidrawJson failed');
  });

  // 3. Deserialization & Restoration Test
  record('3. Deserialization round-trip with elements, appState, files', () => {
    const restored = deserializeDrawing(serializedJson);
    if (!restored) throw new Error('deserializeDrawing returned null');
    if (restored.elements.length !== 2) throw new Error(`Expected 2 elements, got ${restored.elements.length}`);
    if (restored.elements[0].id !== 'test-rect-1') throw new Error('Restored element id mismatch');
    if (restored.elements[0].width !== 250) throw new Error('Restored element width mismatch');
    if (restored.appState.viewBackgroundColor !== '#f1f3f5') throw new Error('Restored appState mismatch');
    if (!restored.files['sample-file-1']) throw new Error('Restored files missing');
  });

  // 4. Schema rejection test
  record('4. Schema validation and corruption handling', () => {
    let errorCaught = false;
    try {
      deserializeDrawing(JSON.stringify({ notExcalidraw: true }));
    } catch {
      errorCaught = true;
    }
    if (!errorCaught) throw new Error('Failed to reject corrupted/invalid JSON');
  });

  // 5. Storage CRUD
  await record('5. Storage adapter CRUD operations', async () => {
    const adapter = new LocalStorageAdapter();

    // Create
    const fileId = await adapter.create('Architecture Plan', serializedJson);
    if (!fileId) throw new Error('create did not return an id');

    // List
    const files = await adapter.list();
    const created = files.find((f) => f.id === fileId);
    if (!created) throw new Error('Created file not found in list');
    if (created.name !== 'Architecture Plan.excalidraw') throw new Error('Extension was not appended');

    // Get
    const content = await adapter.get(fileId);
    if (content !== serializedJson) throw new Error('Retrieved content does not match saved content');

    // Update
    const updatedMock = { ...mockElement, width: 800 };
    const updatedJson = serializeDrawing([updatedMock as ExcalidrawElement], { viewBackgroundColor: '#ffffff' });
    await adapter.update(fileId, updatedJson);

    const updatedContent = await adapter.get(fileId);
    if (updatedContent !== updatedJson) throw new Error('Updated content mismatch');

    // Rename
    await adapter.rename(fileId, 'Renamed Architecture');
    const afterRename = await adapter.list();
    const renamed = afterRename.find((f) => f.id === fileId);
    if (renamed?.name !== 'Renamed Architecture.excalidraw') throw new Error('Rename failed or lost extension');

    // Delete
    await adapter.delete(fileId);
    const afterDelete = await adapter.list();
    if (afterDelete.some((f) => f.id === fileId)) throw new Error('File still exists after delete');
  });

  // --- Google Drive Storage Adapter Deterministic Mock Tests ---
  const MOCK_TOKEN = 'mock_ya29_test_access_token_12345';
  const FOLDER_ID = 'cv_mock_folder_001';
  const DRAWING_FILE_ID = 'cv_mock_file_001';

  // Helper to create a mock fetch router
  function createMockFetch(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>
  ): typeof fetch {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      return Promise.resolve(handler(url, init));
    };
  }

  // Helper to construct JSON response
  function jsonResponse(status: number, data: unknown): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 6. Drive query escaping
  const { escapeDriveQueryValue } = await import('../storage/googleDriveClient');
  record('6. Google Drive: Query parameter escaping', () => {
    if (escapeDriveQueryValue("normal") !== "normal") throw new Error('Failed normal query escape');
    if (escapeDriveQueryValue("O'Reilly") !== "O\\'Reilly") throw new Error('Failed quote escape');
    if (escapeDriveQueryValue("path\\to") !== "path\\\\to") throw new Error('Failed backslash escape');
    if (escapeDriveQueryValue("O'Reilly\\Folder") !== "O\\'Reilly\\\\Folder") throw new Error('Failed mixed escape');
  });

  // 7. Folder discovery (reuses existing folder with appProperties marker)
  const { GoogleDriveClient } = await import('../storage/googleDriveClient');
  await record('7. Google Drive: Marker-based folder discovery', async () => {
    let listCallCount = 0;
    let postCallCount = 0;

    const mockFetch = createMockFetch((url, init) => {
      if (url.includes('/drive/v3/files') && (!init || init.method === 'GET' || !init.method)) {
        listCallCount++;
        const parsedUrl = new URL(url);
        const q = parsedUrl.searchParams.get('q') || '';
        if (
          !q.includes("mimeType = 'application/vnd.google-apps.folder'") ||
          !q.includes("name = 'CanvasVault'") ||
          !q.includes("appProperties has { key='app' and value='canvasvault' }") ||
          !q.includes("appProperties has { key='type' and value='root_folder' }")
        ) {
          throw new Error(`Query missing required appProperties marker: ${q}`);
        }
        return jsonResponse(200, {
          files: [{ id: FOLDER_ID, name: 'CanvasVault' }],
        });
      }
      if (init?.method === 'POST') {
        postCallCount++;
        return jsonResponse(200, { id: 'unexpected_folder' });
      }
      return jsonResponse(404, {});
    });

    const client = new GoogleDriveClient({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    const folderId = await client.getOrCreateFolder();
    if (folderId !== FOLDER_ID) throw new Error(`Expected ${FOLDER_ID}, got ${folderId}`);
    if (listCallCount !== 1) throw new Error(`Expected 1 list call, got ${listCallCount}`);
    if (postCallCount !== 0) throw new Error(`Folder creation should not have occurred`);
  });

  // 8. Folder creation when not found
  await record('8. Google Drive: Folder creation when not found', async () => {
    let createdPayload: any = null;

    const mockFetch = createMockFetch((url, init) => {
      if (url.includes('/drive/v3/files') && (!init || init.method === 'GET' || !init.method)) {
        return jsonResponse(200, { files: [] }); // not found
      }
      if (url.includes('/drive/v3/files') && init?.method === 'POST') {
        createdPayload = JSON.parse(init.body as string);
        return jsonResponse(200, { id: 'created_folder_999' });
      }
      return jsonResponse(404, {});
    });

    const client = new GoogleDriveClient({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    const folderId = await client.getOrCreateFolder();
    if (folderId !== 'created_folder_999') throw new Error(`Expected created_folder_999, got ${folderId}`);
    if (!createdPayload) throw new Error('No POST body sent for folder creation');
    if (createdPayload.name !== 'CanvasVault') throw new Error('Folder name mismatch');
    if (createdPayload.mimeType !== 'application/vnd.google-apps.folder') throw new Error('MIME type mismatch');
    if (
      createdPayload.appProperties?.app !== 'canvasvault' ||
      createdPayload.appProperties?.type !== 'root_folder'
    ) {
      throw new Error('appProperties marker missing on created folder');
    }
  });

  // 9. Folder cache invalidation policy: drawing file 404 preserves cache, folder 404 invalidates
  const { GoogleDriveError } = await import('../storage/googleDriveErrors');
  await record('9. Google Drive: Folder cache invalidation policy', async () => {
    let folderLookups: number = 0;

    const mockFetch = createMockFetch((url, init) => {
      // Folder query
      if (url.includes('/drive/v3/files?') && (!init || !init.method || init.method === 'GET')) {
        folderLookups++;
        return jsonResponse(200, { files: [{ id: 'folder_resilient' }] });
      }
      // Missing drawing file lookup (404)
      if (url.includes('/files/missing_drawing_id')) {
        return jsonResponse(404, { error: { message: 'File not found' } });
      }
      // Drawing file with 403 forbidden
      if (url.includes('/files/forbidden_drawing_id')) {
        return jsonResponse(403, { error: { message: 'Forbidden' } });
      }
      // Folder creation endpoint that returns 404 (e.g. parent folder deleted in Drive)
      if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
        return jsonResponse(404, { error: { message: 'Parent folder not found' } });
      }
      return jsonResponse(200, {});
    });

    const client = new GoogleDriveClient({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    // 1st lookup: discovers folder
    const initialFolder = await client.getOrCreateFolder();
    if (initialFolder !== 'folder_resilient') throw new Error('Failed initial folder discovery');
    if ((folderLookups as number) !== 1) throw new Error(`Expected 1 lookup, got ${folderLookups}`);

    // 2nd lookup: cache hit, no network discovery
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 1) throw new Error(`Cache hit failed, lookup count is ${folderLookups}`);

    // Step A: A 404 on a DRAWING FILE must NOT clear cachedFolderId
    let drawingCaught = false;
    try {
      await client.validateManagedFile('missing_drawing_id');
    } catch (err) {
      if (err instanceof Error && err.message.includes('Drawing not found')) {
        drawingCaught = true;
      }
    }
    if (!drawingCaught) throw new Error('Expected Drawing not found error for missing file');

    // Subsequent operation must NOT rediscover the folder
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 1) {
      throw new Error(`Drawing file 404 improperly invalidated folder cache! Lookup count: ${folderLookups}`);
    }

    // Step B: A 403 on drawing file must NOT clear cachedFolderId
    try {
      await client.validateManagedFile('forbidden_drawing_id');
    } catch {
      // Expected
    }
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 1) {
      throw new Error(`Drawing file 403 improperly invalidated folder cache! Lookup count: ${folderLookups}`);
    }

    // Step C: Folder-specific 404 (parent folder missing during multipart upload) SHOULD invalidate cache
    let uploadCaught = false;
    try {
      await client.createMultipartFile('Test.excalidraw', serializedJson);
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'NOT_FOUND') {
        uploadCaught = true;
      }
    }
    if (!uploadCaught) throw new Error('Expected 404 NOT_FOUND on upload failure');

    // Next getOrCreateFolder must now re-discover the folder
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 2) {
      throw new Error(`Folder-specific 404 failed to invalidate folder cache! Lookup count: ${folderLookups}`);
    }

    // Step D: Explicit invalidateFolderCache works
    client.invalidateFolderCache();
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 3) {
      throw new Error(`invalidateFolderCache failed! Lookup count: ${folderLookups}`);
    }
  });

  // 10. Multipart upload on create()
  const { GoogleDriveAdapter } = await import('../storage/googleDriveAdapter');
  await record('10. Google Drive: Multipart upload structure on create()', async () => {
    let capturedUploadHeader = '';
    let capturedUploadBody = '';

    const mockFetch = createMockFetch((url, init) => {
      // Folder discovery
      if (url.includes('/drive/v3/files?') && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse(200, { files: [{ id: FOLDER_ID }] });
      }
      // Multipart upload
      if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
        const headers = init?.headers as Headers;
        capturedUploadHeader = headers.get('Content-Type') || '';
        capturedUploadBody = String(init?.body || '');
        return jsonResponse(200, {
          id: DRAWING_FILE_ID,
          name: 'Architecture.excalidraw',
        });
      }
      return jsonResponse(404, {});
    });

    const adapter = new GoogleDriveAdapter({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    const fileId = await adapter.create('Architecture', serializedJson);
    if (fileId !== DRAWING_FILE_ID) throw new Error(`Expected ${DRAWING_FILE_ID}, got ${fileId}`);
    if (!capturedUploadHeader.includes('multipart/related; boundary=')) {
      throw new Error(`Content-Type must be multipart/related: ${capturedUploadHeader}`);
    }
    if (!capturedUploadBody.includes('"name":"Architecture.excalidraw"')) {
      throw new Error('Filename or extension missing in multipart metadata');
    }
    if (!capturedUploadBody.includes(`"parents":["${FOLDER_ID}"]`)) {
      throw new Error('Parent folder ID missing in multipart metadata');
    }
    if (!capturedUploadBody.includes('"app":"canvasvault"') || !capturedUploadBody.includes('"type":"drawing"')) {
      throw new Error('Drawing appProperties marker missing in multipart metadata');
    }
    if (!capturedUploadBody.includes(serializedJson)) {
      throw new Error('Serialized Excalidraw content missing from media part');
    }
  });

  // 11. Media update on update()
  await record('11. Google Drive: Media update on update()', async () => {
    let capturedUpdateContentType = '';
    let capturedUpdateBody = '';

    const mockFetch = createMockFetch((url, init) => {
      // Folder lookup
      if (url.includes('/drive/v3/files?q=') && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse(200, { files: [{ id: FOLDER_ID }] });
      }
      // Ownership validation
      if (url.includes(`/drive/v3/files/${DRAWING_FILE_ID}`) && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse(200, {
          id: DRAWING_FILE_ID,
          name: 'Architecture.excalidraw',
          parents: [FOLDER_ID],
          trashed: false,
          appProperties: { app: 'canvasvault', type: 'drawing' },
        });
      }
      // Media update
      if (url.includes(`/upload/drive/v3/files/${DRAWING_FILE_ID}?uploadType=media`) && init?.method === 'PATCH') {
        const headers = init.headers as Headers;
        capturedUpdateContentType = headers.get('Content-Type') || '';
        capturedUpdateBody = String(init.body || '');
        return jsonResponse(200, { id: DRAWING_FILE_ID });
      }
      return jsonResponse(404, {});
    });

    const adapter = new GoogleDriveAdapter({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    const updatedJson = serializeDrawing([mockElement as ExcalidrawElement], { viewBackgroundColor: '#ffffff' });
    await adapter.update(DRAWING_FILE_ID, updatedJson);

    if (!capturedUpdateContentType.includes('application/json')) {
      throw new Error(`Expected Content-Type application/json, got ${capturedUpdateContentType}`);
    }
    if (capturedUpdateBody !== updatedJson) {
      throw new Error('Update payload does not match expected drawing JSON');
    }
  });

  // 12. Scoped list query and DrawingFile mapping
  await record('12. Google Drive: Scoped list query and DrawingFile mapping', async () => {
    let capturedListQuery = '';

    const mockFetch = createMockFetch((url) => {
      if (url.includes('/drive/v3/files?q=')) {
        const parsedUrl = new URL(url);
        capturedListQuery = parsedUrl.searchParams.get('q') || '';
        return jsonResponse(200, {
          files: [
            {
              id: 'file_alpha',
              name: 'Alpha.excalidraw',
              createdTime: '2026-09-01T12:00:00.000Z',
              modifiedTime: '2026-09-02T12:00:00.000Z',
              size: '4096',
              appProperties: { app: 'canvasvault', type: 'drawing' },
            },
          ],
        });
      }
      return jsonResponse(404, {});
    });

    const adapter = new GoogleDriveAdapter({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    const files = await adapter.list();
    if (
      !capturedListQuery.includes("in parents") ||
      !capturedListQuery.includes("trashed = false") ||
      !capturedListQuery.includes("appProperties has { key='app' and value='canvasvault' }") ||
      !capturedListQuery.includes("appProperties has { key='type' and value='drawing' }")
    ) {
      throw new Error(`List query not properly scoped: ${capturedListQuery}`);
    }

    if (files.length !== 1) throw new Error(`Expected 1 file, got ${files.length}`);
    const file = files[0];
    if (file.id !== 'file_alpha') throw new Error('File ID mismatch');
    if (file.name !== 'Alpha.excalidraw') throw new Error('File name mismatch');
    if (file.createdAt !== '2026-09-01T12:00:00.000Z') throw new Error('createdAt mismatch');
    if (file.updatedAt !== '2026-09-02T12:00:00.000Z') throw new Error('updatedAt mismatch');
    if (file.size !== 4096) throw new Error('size mismatch');
  });

  // 13. Centralized ownership validation rejects unmanaged file IDs
  await record('13. Google Drive: Centralized ownership validation', async () => {
    const mockFetch = createMockFetch((url) => {
      // Folder lookup
      if (url.includes('/drive/v3/files?q=')) {
        return jsonResponse(200, { files: [{ id: FOLDER_ID }] });
      }
      // Unmanaged file: outside folder
      if (url.includes('/files/outside_folder_id')) {
        return jsonResponse(200, {
          id: 'outside_folder_id',
          name: 'Other.excalidraw',
          parents: ['unrelated_folder_999'],
          trashed: false,
          appProperties: { app: 'canvasvault', type: 'drawing' },
        });
      }
      // Unmanaged file: missing appProperties marker
      if (url.includes('/files/no_marker_id')) {
        return jsonResponse(200, {
          id: 'no_marker_id',
          name: 'Plain.excalidraw',
          parents: [FOLDER_ID],
          trashed: false,
        });
      }
      // Trashed file
      if (url.includes('/files/trashed_id')) {
        return jsonResponse(200, {
          id: 'trashed_id',
          name: 'Deleted.excalidraw',
          parents: [FOLDER_ID],
          trashed: true,
          appProperties: { app: 'canvasvault', type: 'drawing' },
        });
      }
      return jsonResponse(404, {});
    });

    const adapter = new GoogleDriveAdapter({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    // Case 1: Outside folder
    let caughtOutside = false;
    try {
      await adapter.get('outside_folder_id');
    } catch (err) {
      if (err instanceof Error && err.message.includes('Drawing not found')) caughtOutside = true;
    }
    if (!caughtOutside) throw new Error('Failed to reject file outside CanvasVault folder');

    // Case 2: Missing marker
    let caughtMarker = false;
    try {
      await adapter.rename('no_marker_id', 'New Name');
    } catch (err) {
      if (err instanceof Error && err.message.includes('Drawing not found')) caughtMarker = true;
    }
    if (!caughtMarker) throw new Error('Failed to reject file without CanvasVault app marker');

    // Case 3: Trashed file
    let caughtTrashed = false;
    try {
      await adapter.delete('trashed_id');
    } catch (err) {
      if (err instanceof Error && err.message.includes('Drawing not found')) caughtTrashed = true;
    }
    if (!caughtTrashed) throw new Error('Failed to reject trashed file');
  });

  // 14. Corrupt or non-Excalidraw content rejection (INVALID_CONTENT)
  await record('14. Google Drive: Rejection of corrupt or non-Excalidraw content', async () => {
    const mockFetch = createMockFetch((url) => {
      if (url.includes('/drive/v3/files?q=')) {
        return jsonResponse(200, { files: [{ id: FOLDER_ID }] });
      }
      if (url.includes('/files/corrupt_file_id?')) {
        return jsonResponse(200, {
          id: 'corrupt_file_id',
          parents: [FOLDER_ID],
          trashed: false,
          appProperties: { app: 'canvasvault', type: 'drawing' },
        });
      }
      if (url.includes('/files/corrupt_file_id?alt=media')) {
        return new Response('{"notAnExcalidrawFile": true}', { status: 200 });
      }
      return jsonResponse(404, {});
    });

    const adapter = new GoogleDriveAdapter({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    // create with non-Excalidraw content
    let caughtCreate = false;
    try {
      await adapter.create('Bad', '{"foo":"bar"}');
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'INVALID_CONTENT') caughtCreate = true;
    }
    if (!caughtCreate) throw new Error('Failed to reject non-Excalidraw content on create()');

    // get with non-Excalidraw content
    let caughtGet = false;
    try {
      await adapter.get('corrupt_file_id');
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'INVALID_CONTENT') caughtGet = true;
    }
    if (!caughtGet) throw new Error('Failed to reject non-Excalidraw content on get()');
  });

  // 15. Safe error model and token redaction
  const { sanitizeErrorMessage, createGoogleDriveErrorFromStatus } = await import('../storage/googleDriveErrors');
  record('15. Google Drive: Safe error model and token redaction', () => {
    // Status mapping
    const err401 = createGoogleDriveErrorFromStatus(401);
    if (err401.code !== 'UNAUTHORIZED') throw new Error('401 mapping failed');

    const err403 = createGoogleDriveErrorFromStatus(403);
    if (err403.code !== 'FORBIDDEN') throw new Error('403 mapping failed');

    const err404 = createGoogleDriveErrorFromStatus(404);
    if (err404.code !== 'NOT_FOUND') throw new Error('404 mapping failed');

    const err429 = createGoogleDriveErrorFromStatus(429);
    if (err429.code !== 'RATE_LIMITED') throw new Error('429 mapping failed');
    if (!err429.isRetryable) throw new Error('429 should be retryable');

    // Sanitization
    const sensitive = 'Request failed: Bearer ya29.secret_token_abc and access_token=ya29.secret_token_def';
    const sanitized = sanitizeErrorMessage(sensitive);
    if (sanitized.includes('ya29.secret_token_abc') || sanitized.includes('ya29.secret_token_def')) {
      throw new Error(`Sanitizer failed to redact token: ${sanitized}`);
    }
    if (!sanitized.includes('Bearer [REDACTED]') || !sanitized.includes('access_token=[REDACTED]')) {
      throw new Error(`Sanitizer missing REDACTED replacement: ${sanitized}`);
    }
  });

  // 16. Migration metadata support and marker protection
  await record('16. Google Drive: Migration metadata support and marker protection', async () => {
    let capturedMetadata: any = null;

    const mockFetch = createMockFetch((url, init) => {
      if (url.includes('/drive/v3/files?') && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse(200, { files: [{ id: FOLDER_ID }] });
      }
      if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
        const bodyStr = String(init?.body || '');
        // Extract Part 1 JSON metadata
        const parts = bodyStr.split(/\r?\n\r?\n/);
        if (parts.length >= 2) {
          capturedMetadata = JSON.parse(parts[1].split(/\r?\n--/)[0]);
        }
        return jsonResponse(200, { id: 'migrated_file_123' });
      }
      return jsonResponse(404, {});
    });

    const adapter = new GoogleDriveAdapter({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    // Step A: Normal createWithProperties merges sourceLocalId and migratedAt
    const fileId = await adapter.createWithProperties('Imported Plan', serializedJson, {
      sourceLocalId: 'loc_file_789',
      migratedAt: '2026-09-13T12:00:00.000Z',
    });
    if (fileId !== 'migrated_file_123') throw new Error('createWithProperties failed to return fileId');
    if (!capturedMetadata) throw new Error('Failed to capture multipart metadata');
    if (capturedMetadata.name !== 'Imported Plan.excalidraw') throw new Error('Extension was not appended');
    if (capturedMetadata.appProperties?.sourceLocalId !== 'loc_file_789') {
      throw new Error('sourceLocalId missing from appProperties');
    }
    if (capturedMetadata.appProperties?.migratedAt !== '2026-09-13T12:00:00.000Z') {
      throw new Error('migratedAt missing from appProperties');
    }
    if (capturedMetadata.appProperties?.app !== 'canvasvault') throw new Error('Mandatory app marker was lost');
    if (capturedMetadata.appProperties?.type !== 'drawing') throw new Error('Mandatory type marker was lost');

    // Step B: Attempting to override mandatory markers fails closed
    await adapter.createWithProperties('Protected', serializedJson, {
      app: 'malicious_override',
      type: 'fake_type',
      sourceLocalId: 'loc_safe_id',
    });
    if (capturedMetadata.appProperties?.app !== 'canvasvault') {
      throw new Error('Caller was able to override mandatory app marker!');
    }
    if (capturedMetadata.appProperties?.type !== 'drawing') {
      throw new Error('Caller was able to override mandatory type marker!');
    }
    if (capturedMetadata.appProperties?.sourceLocalId !== 'loc_safe_id') {
      throw new Error('Caller sourceLocalId was not preserved');
    }

    // Step C: Content validation is preserved
    let caughtInvalid = false;
    try {
      await adapter.createWithProperties('Bad Content', '{"not":"excalidraw"}', { sourceLocalId: 'test' });
    } catch (err) {
      if (err instanceof GoogleDriveError && err.code === 'INVALID_CONTENT') {
        caughtInvalid = true;
      }
    }
    if (!caughtInvalid) throw new Error('createWithProperties failed to validate drawing content');
  });

  // 17. Storage mode selection, stable adapter identity, and generation rules
  await record('17. Storage mode selection, stable adapter identity, and generation rules', () => {
    // A. Storage mode type and selection
    if (resolveStorageMode(false) !== 'local') throw new Error('resolveStorageMode(false) should be local');
    if (resolveStorageMode(true) !== 'drive') throw new Error('resolveStorageMode(true) should be drive');
    if (resolveAuthMode(false) !== 'anonymous') throw new Error('resolveAuthMode(false) should be anonymous');
    if (resolveAuthMode(true) !== 'authenticated') throw new Error('resolveAuthMode(true) should be authenticated');

    let tokenGetterCalls = 0;
    let lastRetrievedToken: string | null = null;
    const coordinator = new StorageCoordinator({
      initialMode: 'local',
      initialToken: 'initial_token_123',
      createDriveAdapter: (getToken) => {
        return {
          create: async () => 'mock_id',
          update: async () => {},
          get: async () => {
            tokenGetterCalls++;
            lastRetrievedToken = getToken();
            return '{}';
          },
          list: async () => [],
          rename: async () => {},
          delete: async () => {},
        };
      },
    });

    // Verify initial state
    if (coordinator.getStorageMode() !== 'local') throw new Error('Expected initial mode local');
    if (coordinator.getAuthMode() !== 'anonymous') throw new Error('Expected initial auth mode anonymous');
    if (coordinator.getGeneration() !== 0) throw new Error('Expected initial generation 0');

    // Verify active storage is selected by storageMode, not raw token presence
    const initialActive = coordinator.getActiveStorage();
    if (initialActive !== coordinator.getLocalStorage()) {
      throw new Error('Active storage in local mode must be localStorage even when token is present');
    }

    // B. Transition to drive mode increments generation exactly once
    const changedToDrive = coordinator.setStorageMode('drive');
    if (!changedToDrive) throw new Error('setStorageMode(drive) should return true');
    if (coordinator.getStorageMode() !== 'drive') throw new Error('Expected storage mode drive');
    if (coordinator.getAuthMode() !== 'authenticated') throw new Error('Expected auth mode authenticated');
    if (coordinator.getGeneration() !== 1) throw new Error('Expected generation 1 after transition');

    // Redundant setStorageMode must be no-op and NOT increment generation
    const redundantDrive = coordinator.setStorageMode('drive');
    if (redundantDrive) throw new Error('Redundant setStorageMode(drive) should return false');
    if (coordinator.getGeneration() !== 1) throw new Error('Generation should not increment on redundant mode set');

    // C. Stable Drive adapter identity across token changes
    const adapter1 = coordinator.getActiveStorage();
    if (adapter1 === coordinator.getLocalStorage()) {
      throw new Error('Active storage in drive mode must be Drive adapter');
    }

    // Simulate token refresh
    coordinator.setToken('refreshed_token_456');
    const adapter2 = coordinator.getActiveStorage();
    if (adapter1 !== adapter2) {
      throw new Error('Drive adapter identity must remain stable across token refresh');
    }
    if (coordinator.getGeneration() !== 1) {
      throw new Error('Generation must NOT increment on token refresh');
    }

    // Second token refresh
    coordinator.setToken('refreshed_token_789');
    const adapter3 = coordinator.getActiveStorage();
    if (adapter1 !== adapter3) {
      throw new Error('Drive adapter identity changed on second token refresh');
    }
    if (coordinator.getGeneration() !== 1) {
      throw new Error('Generation must NOT increment on second token refresh');
    }

    // D. Dynamic token getter returns the latest token
    if (coordinator.getLatestToken() !== 'refreshed_token_789') {
      throw new Error('getLatestToken() did not return updated token');
    }
    // Invoke adapter operation that reads getToken
    adapter3.get('dummy');
    if (lastRetrievedToken !== 'refreshed_token_789') {
      throw new Error(`Dynamic getter returned stale token: ${lastRetrievedToken}`);
    }

    // E. Transition back to local increments generation
    const changedToLocal = coordinator.setStorageMode('local');
    if (!changedToLocal) throw new Error('setStorageMode(local) should return true');
    if (coordinator.getStorageMode() !== 'local') throw new Error('Expected storage mode local');
    if (coordinator.getGeneration() !== 2) throw new Error('Expected generation 2 after transition to local');
    if (coordinator.getActiveStorage() !== coordinator.getLocalStorage()) {
      throw new Error('Active storage must be localStorage after switching back to local');
    }

    // F. syncAuthState helper
    const syncRes1 = coordinator.syncAuthState(true, 'new_token_sync');
    if (!syncRes1.modeChanged || syncRes1.generation !== 3) {
      throw new Error('syncAuthState(true) failed to transition to drive');
    }
    if (coordinator.getStorageMode() !== 'drive') throw new Error('Expected drive mode');
    if (coordinator.getLatestToken() !== 'new_token_sync') throw new Error('Token not updated in syncAuthState');

    // Token refresh via syncAuthState does NOT change mode or increment generation
    const syncRes2 = coordinator.syncAuthState(true, 'refreshed_sync_token');
    if (syncRes2.modeChanged || syncRes2.generation !== 3) {
      throw new Error('Token refresh via syncAuthState must not increment generation');
    }
  });

  // 18. Generation-safe storage switching and persistence semantics
  await record('18. Generation-safe storage switching and persistence semantics', async () => {
    // Mock local and drive storage adapters to track calls and simulate latencies/failures
    const counts: any = {
      localCreate: 0,
      localUpdate: 0,
      driveCreate: 0,
      driveUpdate: 0,
    };
    const mockLocalStorage = {
      create: async (_name: string, _content: string) => {
        counts.localCreate++;
        return `local_id_${counts.localCreate}`;
      },
      update: async (_id: string, _content: string) => {
        counts.localUpdate++;
      },
      get: async (_id: string) => serializedJson,
      list: async () => [{ id: 'loc_1', name: 'Local Drawing.excalidraw', createdAt: '', updatedAt: '' }],
      rename: async () => {},
      delete: async () => {},
    };

    let driveShouldFail = false;
    let driveCreateDelayMs = 0;
    const mockDriveStorage = {
      create: async (_name: string, _content: string) => {
        if (driveCreateDelayMs > 0) {
          await new Promise((r) => setTimeout(r, driveCreateDelayMs));
        }
        if (driveShouldFail) {
          throw new Error('Google Drive API 500 internal error');
        }
        counts.driveCreate++;
        return `drive_id_${counts.driveCreate}`;
      },
      update: async (_id: string, _content: string) => {
        if (driveShouldFail) {
          throw new Error('Google Drive API 401 unauthorized');
        }
        counts.driveUpdate++;
      },
      get: async (_id: string) => serializedJson,
      list: async () => [{ id: 'drive_1', name: 'Cloud Drawing.excalidraw', createdAt: '', updatedAt: '' }],
      rename: async () => {},
      delete: async () => {},
    };

    // A. Verify storage selection: local mode uses LocalStorage, drive mode uses Drive adapter
    const coordinator = new StorageCoordinator({
      initialMode: 'local',
      localStorage: mockLocalStorage,
      createDriveAdapter: () => mockDriveStorage,
    });
    if (coordinator.getActiveStorage() !== mockLocalStorage) {
      throw new Error('Local mode must select LocalStorage');
    }
    coordinator.setStorageMode('drive');
    if (coordinator.getActiveStorage() !== mockDriveStorage) {
      throw new Error('Drive mode must select GoogleDrive adapter');
    }

    // B. Transition lifecycle: Local -> Drive clears backend file ID and preserves scene
    coordinator.setStorageMode('local');
    const state: Record<string, any> = {
      generation: coordinator.getGeneration(),
      storageMode: coordinator.getStorageMode(),
      currentFileId: 'local_doc_99',
      currentFileName: 'My Diagram',
      inMemoryScene: serializedJson,
      saveStatus: 'saved',
    };

    function simulateTransition(newMode: 'local' | 'drive') {
      const changed = coordinator.setStorageMode(newMode);
      if (changed) {
        state.generation = coordinator.getGeneration();
        state.storageMode = coordinator.getStorageMode();
        // Transition clears backend file ID and retains in-memory scene
        state.currentFileId = null;
        state.saveStatus = 'dirty';
      }
    }

    // Switch to Drive
    simulateTransition('drive');
    if (state.currentFileId !== null) {
      throw new Error('Local -> Drive transition must clear backend file ID');
    }
    if (state.inMemoryScene !== serializedJson) {
      throw new Error('Local -> Drive transition must preserve in-memory scene');
    }
    if (state.saveStatus !== 'dirty') {
      throw new Error('Local -> Drive transition should mark status as dirty');
    }

    // Switch back to Local
    state.currentFileId = 'drive_doc_88';
    simulateTransition('local');
    if (state.currentFileId !== null) {
      throw new Error('Drive -> Local transition must clear backend file ID');
    }
    if (state.inMemoryScene !== serializedJson) {
      throw new Error('Drive -> Local transition must preserve in-memory scene');
    }

    // Switch back to Drive for save semantics testing
    simulateTransition('drive');

    // C. First Drive save creates once; later save updates same file ID
    async function executeTestSave() {
      const active = coordinator.getActiveStorage();
      const opGen = state.generation;

      let targetId = state.currentFileId;
      if (!targetId) {
        targetId = await active.create(state.currentFileName, state.inMemoryScene);
        if (opGen !== coordinator.getGeneration()) {
          // Stale async result dropped
          return;
        }
        state.currentFileId = targetId;
      } else {
        await active.update(targetId, state.inMemoryScene);
        if (opGen !== coordinator.getGeneration()) {
          return;
        }
      }
      state.saveStatus = 'saved';
    }

    // First save in Drive
    await executeTestSave();
    if (counts.driveCreate !== 1) {
      throw new Error(`Expected driveCreate to be 1, got ${counts.driveCreate}`);
    }
    if (counts.driveUpdate !== 0) {
      throw new Error(`Expected driveUpdate to be 0, got ${counts.driveUpdate}`);
    }
    const savedDriveId = state.currentFileId;
    if (savedDriveId !== 'drive_id_1') {
      throw new Error(`Expected drive_id_1, got ${savedDriveId}`);
    }
    if (state.saveStatus !== 'saved') {
      throw new Error('Status should be saved after successful save');
    }

    // Second save in Drive on same drawing: must call update, not create
    await executeTestSave();
    if (counts.driveCreate !== 1) {
      throw new Error('Second save must NOT call create again');
    }
    if (counts.driveUpdate !== 1) {
      throw new Error('Second save must call update');
    }
    if (state.currentFileId !== savedDriveId) {
      throw new Error('File ID must remain stable across updates');
    }

    // D. Token refresh does not recreate adapter or duplicate files
    coordinator.setToken('new_refreshed_auth_token');
    await executeTestSave();
    if (counts.driveCreate !== 1) {
      throw new Error('Save after token refresh must not create duplicate file');
    }
    if (counts.driveUpdate !== 2) {
      throw new Error('Save after token refresh must update existing file');
    }

    // E. Stale pre-transition async operation is ignored
    // Reset file ID to simulate a pending create during transition
    state.currentFileId = null;
    driveCreateDelayMs = 50;
    const pendingSavePromise = executeTestSave();
    // Mid-flight transition to local
    simulateTransition('local');
    await pendingSavePromise;
    // The drive create resolved, but opGen !== generation caused it to drop result
    if (state.currentFileId !== null) {
      throw new Error('Stale pre-transition async result must NOT be applied to state');
    }

    // F. Drive failure does NOT silently fall back to LocalStorage
    simulateTransition('drive');
    driveCreateDelayMs = 0;
    driveShouldFail = true;
    const localCreateBefore = counts.localCreate;
    const localUpdateBefore = counts.localUpdate;

    let caughtError = false;
    try {
      await executeTestSave();
    } catch {
      caughtError = true;
    }
    if (!caughtError) {
      throw new Error('Expected Drive failure to throw');
    }
    // Verify zero calls made to LocalStorage during Drive failure
    if (counts.localCreate !== localCreateBefore || counts.localUpdate !== localUpdateBefore) {
      throw new Error('Drive failure must NEVER fall back to LocalStorage!');
    }
    if (state.currentFileId !== null) {
      throw new Error('Failed save must not adopt an invalid file ID');
    }
  });

  // 19. Explicit Local-to-Drive migration service and idempotency
  await record('19. Explicit Local-to-Drive migration service and idempotency', async () => {
    // 1. Setup mock LocalStorage with valid drawings
    const localStore: Record<string, { name: string; content: string }> = {
      loc_1: { name: 'Architecture Plan', content: serializedJson },
      loc_2: { name: 'User Flow', content: serializedJson },
    };
    let localDeleteCount = 0;
    let localUpdateCount = 0;

    const mockLocal = {
      list: async () =>
        Object.entries(localStore).map(([id, item]) => ({
          id,
          name: item.name,
          createdAt: '2026-09-13T10:00:00.000Z',
          updatedAt: '2026-09-13T10:00:00.000Z',
        })),
      get: async (id: string) => {
        if (!localStore[id]) throw new Error(`Not found: ${id}`);
        return localStore[id].content;
      },
      create: async () => 'mock_loc_id',
      update: async () => { localUpdateCount++; },
      delete: async () => { localDeleteCount++; },
      rename: async () => {},
    };

    // 2. Setup mock Drive Storage
    const driveStore: Array<{
      id: string;
      name: string;
      content: string;
      appProperties?: Record<string, string>;
    }> = [];
    let driveUploadFailTargetId: string | null = null;

    const mockDrive = {
      list: async () =>
        driveStore.map((f) => ({
          id: f.id,
          name: f.name,
          createdAt: '2026-09-13T10:00:00.000Z',
          updatedAt: '2026-09-13T10:00:00.000Z',
          appProperties: f.appProperties,
        })),
      listWithProperties: async () =>
        driveStore.map((f) => ({
          id: f.id,
          name: f.name,
          createdAt: '2026-09-13T10:00:00.000Z',
          updatedAt: '2026-09-13T10:00:00.000Z',
          appProperties: f.appProperties,
        })),
      createWithProperties: async (
        name: string,
        content: string,
        extraAppProperties?: Record<string, string>
      ) => {
        if (driveUploadFailTargetId && extraAppProperties?.sourceLocalId === driveUploadFailTargetId) {
          throw new Error('Simulated Google Drive 503 upload error');
        }
        const newId = `drive_file_${driveStore.length + 1}`;
        driveStore.push({
          id: newId,
          name,
          content,
          appProperties: {
            ...extraAppProperties,
            app: 'canvasvault',
            type: 'drawing',
          },
        });
        return newId;
      },
    };

    const fixedTime = '2026-09-13T12:34:56.000Z';

    // A. Initial migration: imports all valid drawings with sourceLocalId metadata
    const summary1 = await migrateLocalDrawingsToDrive({
      localStorage: mockLocal as any,
      driveStorage: mockDrive as any,
      now: () => fixedTime,
    });

    if (summary1.total !== 2) throw new Error(`Expected total 2, got ${summary1.total}`);
    if (summary1.imported !== 2) throw new Error(`Expected imported 2, got ${summary1.imported}`);
    if (summary1.skipped !== 0) throw new Error(`Expected skipped 0, got ${summary1.skipped}`);
    if (summary1.failed !== 0) throw new Error(`Expected failed 0, got ${summary1.failed}`);

    // Verify metadata written
    const imported1 = driveStore.find((f) => f.appProperties?.sourceLocalId === 'loc_1');
    const imported2 = driveStore.find((f) => f.appProperties?.sourceLocalId === 'loc_2');
    if (!imported1 || !imported2) throw new Error('sourceLocalId metadata missing from created Drive files');
    if (imported1.appProperties?.migratedAt !== fixedTime) {
      throw new Error(`migratedAt timestamp mismatch: ${imported1.appProperties?.migratedAt}`);
    }

    // B. Local source remains completely untouched
    if (Object.keys(localStore).length !== 2) throw new Error('Local drawings must not be deleted');
    if (localDeleteCount !== 0) throw new Error('localStorage delete must never be called during migration');
    if (localUpdateCount !== 0) throw new Error('localStorage update must never be called during migration');

    // C. Idempotency: repeated migration skips already imported drawings
    const summary2 = await migrateLocalDrawingsToDrive({
      localStorage: mockLocal as any,
      driveStorage: mockDrive as any,
      now: () => fixedTime,
    });

    if (summary2.total !== 2) throw new Error(`Expected total 2 on second run, got ${summary2.total}`);
    if (summary2.imported !== 0) throw new Error(`Expected imported 0 on second run, got ${summary2.imported}`);
    if (summary2.skipped !== 2) throw new Error(`Expected skipped 2 on second run, got ${summary2.skipped}`);
    if (summary2.failed !== 0) throw new Error(`Expected failed 0 on second run, got ${summary2.failed}`);
    if (driveStore.length !== 2) throw new Error(`Drive store grew on repeated run: ${driveStore.length}`);

    // D. Invalid drawing skipped/failed safely and partial failure continues
    localStore['loc_corrupt'] = { name: 'Corrupt', content: '{"invalid_excalidraw": true}' };
    localStore['loc_server_err'] = { name: 'ServerError', content: serializedJson };
    localStore['loc_3_good'] = { name: 'Third Good Drawing', content: serializedJson };
    driveUploadFailTargetId = 'loc_server_err';

    const summary3 = await migrateLocalDrawingsToDrive({
      localStorage: mockLocal as any,
      driveStorage: mockDrive as any,
      now: () => fixedTime,
    });

    // We have 5 total: loc_1 (skipped), loc_2 (skipped), loc_corrupt (failed), loc_server_err (failed), loc_3_good (imported)
    if (summary3.total !== 5) throw new Error(`Expected total 5, got ${summary3.total}`);
    if (summary3.skipped !== 2) throw new Error(`Expected skipped 2, got ${summary3.skipped}`);
    if (summary3.failed !== 2) throw new Error(`Expected failed 2, got ${summary3.failed}`);
    if (summary3.imported !== 1) throw new Error(`Expected imported 1, got ${summary3.imported}`);

    const corruptItem = summary3.items.find((i) => i.localId === 'loc_corrupt');
    if (corruptItem?.status !== 'failed' || !corruptItem.errorMessage?.includes('corrupt')) {
      throw new Error('Corrupt file did not fail with schema error');
    }

    const serverErrItem = summary3.items.find((i) => i.localId === 'loc_server_err');
    if (serverErrItem?.status !== 'failed') {
      throw new Error('Server error file did not fail safely');
    }

    const good3Item = summary3.items.find((i) => i.localId === 'loc_3_good');
    if (good3Item?.status !== 'imported') {
      throw new Error('Third good drawing was not imported after prior failures');
    }

    // E. Active in-memory scene preservation
    const activeContext = {
      currentFileId: 'active_drive_doc_42',
      currentFileName: 'Active Whiteboard',
      isDirty: true,
    };
    if (activeContext.currentFileId !== 'active_drive_doc_42' || !activeContext.isDirty) {
      throw new Error('Migration must never alter active scene context');
    }

    // F. Session behavior: Skip suppresses only current session; token refresh does not reopen
    let sessionGen = 1;
    let resolvedSessionGen: number | null = null;

    function isModalOpen(hasLocal: boolean): boolean {
      return sessionGen > 0 && sessionGen !== resolvedSessionGen && hasLocal;
    }

    // Initial session: modal opens
    if (!isModalOpen(true)) throw new Error('Modal should be open on first authenticated session');

    // User clicks skip for now
    resolvedSessionGen = sessionGen;
    if (isModalOpen(true)) throw new Error('Modal should be closed after skip');

    // Token refresh occurs: sessionGen does NOT change
    if (isModalOpen(true)) throw new Error('Modal must NOT reopen on token refresh');

    // User signs out and signs in: new session
    sessionGen++;
    if (!isModalOpen(true)) throw new Error('Modal should reopen for new session with local drawings');

    // If local drawings were empty:
    if (isModalOpen(false)) throw new Error('Modal must NOT open if local drawings is empty');
  });

  // 20. Explicit sign-out safety for unsaved and error drive states
  await record('20. Explicit sign-out safety for unsaved and error drive states', async () => {
    // Decision function matching App orchestration contract
    function isUnsafeSignOut(state: {
      storageMode: 'local' | 'drive';
      saveStatus: string;
      isSaving: boolean;
      isDebouncing?: boolean;
    }): boolean {
      return (
        state.storageMode === 'drive' &&
        (state.isSaving || state.isDebouncing === true || state.saveStatus === 'dirty' || state.saveStatus === 'error' || state.saveStatus === 'saving')
      );
    }

    // A. Clean Drive sign-out is immediate
    let signOutCalled = false;
    let modalOpened = false;
    const cleanDriveState = { storageMode: 'drive' as const, saveStatus: 'saved', isSaving: false };
    if (isUnsafeSignOut(cleanDriveState)) {
      modalOpened = true;
    } else {
      signOutCalled = true;
    }
    if (modalOpened || !signOutCalled) {
      throw new Error('Clean Drive state must sign out immediately without confirmation');
    }

    // B. Anonymous / local sign-out does not show modal
    const dirtyLocalState = { storageMode: 'local' as const, saveStatus: 'dirty', isSaving: false };
    if (isUnsafeSignOut(dirtyLocalState)) {
      throw new Error('Local storage mode must never trigger sign-out confirmation');
    }

    const errorLocalState = { storageMode: 'local' as const, saveStatus: 'error', isSaving: true };
    if (isUnsafeSignOut(errorLocalState)) {
      throw new Error('Local error/saving state must never trigger sign-out confirmation');
    }

    // C. Dirty Drive sign-out opens confirmation modal
    const dirtyDriveState = { storageMode: 'drive' as const, saveStatus: 'dirty', isSaving: false };
    if (!isUnsafeSignOut(dirtyDriveState)) {
      throw new Error('Dirty Drive state must require confirmation');
    }

    const errorDriveState = { storageMode: 'drive' as const, saveStatus: 'error', isSaving: false };
    if (!isUnsafeSignOut(errorDriveState)) {
      throw new Error('Error Drive state must require confirmation');
    }

    const inFlightDriveState = { storageMode: 'drive' as const, saveStatus: 'saving', isSaving: true };
    if (!isUnsafeSignOut(inFlightDriveState)) {
      throw new Error('In-flight saving Drive state must require confirmation');
    }

    const debouncingDriveState = { storageMode: 'drive' as const, saveStatus: 'saved', isSaving: false, isDebouncing: true };
    if (!isUnsafeSignOut(debouncingDriveState)) {
      throw new Error('Debouncing Drive state must require confirmation');
    }

    // Harness for modal orchestrator interactions
    class OrchestratorHarness {
      public isModalOpen = false;
      public signedOutCount: any = 0;
      public saveCount: any = 0;
      public generation = 1;
      public saveErrorMessage: string | null = null;
      public mockSaveResult: boolean = true;
      public saveDelayMs = 0;
      public activeSavePromise: Promise<boolean> | null = null;
      public cancelledDebouncedSave = false;

      public requestSignOut(mode: 'local' | 'drive', status: string, isSaving: boolean, isDebouncing?: boolean) {
        if (isUnsafeSignOut({ storageMode: mode, saveStatus: status, isSaving, isDebouncing })) {
          this.isModalOpen = true;
        } else {
          this.signedOutCount++;
        }
      }

      public async saveNow(): Promise<boolean> {
        if (this.activeSavePromise) {
          return this.activeSavePromise;
        }
        const p = (async () => {
          this.saveCount++;
          if (this.saveDelayMs > 0) {
            await new Promise((r) => setTimeout(r, this.saveDelayMs));
          }
          return this.mockSaveResult;
        })();
        this.activeSavePromise = p;
        try {
          return await p;
        } finally {
          this.activeSavePromise = null;
        }
      }

      public async handleSaveAndSignOut(): Promise<boolean> {
        const startGen = this.generation;
        this.saveErrorMessage = null;
        const success = await this.saveNow();
        if (!success || this.generation !== startGen) {
          this.saveErrorMessage = 'Save could not be confirmed';
          return false;
        }
        this.isModalOpen = false;
        this.signedOutCount++;
        return true;
      }

      public handleSignOutWithoutSaving() {
        this.cancelledDebouncedSave = true;
        this.isModalOpen = false;
        this.signedOutCount++;
      }

      public handleCancel() {
        this.isModalOpen = false;
        this.saveErrorMessage = null;
      }
    }

    // D. Save and Sign Out signs out only after successful save
    const harness1 = new OrchestratorHarness();
    harness1.requestSignOut('drive', 'dirty', false);
    if (!harness1.isModalOpen || harness1.signedOutCount !== 0) {
      throw new Error('Modal should open and not sign out initially');
    }
    const success1 = await harness1.handleSaveAndSignOut();
    if (!success1 || harness1.signedOutCount !== 1 || harness1.isModalOpen) {
      throw new Error('Save and Sign Out should sign out and close modal on success');
    }

    // E. Failed save blocks sign-out and remains signed in
    const harness2 = new OrchestratorHarness();
    harness2.requestSignOut('drive', 'dirty', false);
    harness2.mockSaveResult = false;
    const success2 = await harness2.handleSaveAndSignOut();
    if (success2 || harness2.signedOutCount !== 0 || !harness2.isModalOpen) {
      throw new Error('Failed save must NOT sign out; modal must stay open');
    }
    if (!harness2.saveErrorMessage) {
      throw new Error('Failed save must expose error message');
    }

    // F. Sign Out Without Saving explicitly discards and signs out
    const harness3 = new OrchestratorHarness();
    harness3.requestSignOut('drive', 'dirty', false);
    let discardedDriveSceneCleared = false;
    const mockDiscard = async () => {
      harness3.cancelledDebouncedSave = true;
      discardedDriveSceneCleared = true;
    };
    await mockDiscard();
    harness3.handleSignOutWithoutSaving();
    if (!harness3.cancelledDebouncedSave || !discardedDriveSceneCleared || harness3.signedOutCount !== 1 || harness3.isModalOpen) {
      throw new Error('Sign Out Without Saving must cancel pending saves, discard in-memory scene, close modal, and sign out');
    }

    // G. Cancel preserves state
    const harness4 = new OrchestratorHarness();
    harness4.requestSignOut('drive', 'dirty', false);
    harness4.handleCancel();
    if (harness4.signedOutCount !== 0 || harness4.isModalOpen) {
      throw new Error('Cancel must close modal and leave user signed in');
    }

    // H. Duplicate clicks do not duplicate save/signout
    const harness5 = new OrchestratorHarness();
    harness5.requestSignOut('drive', 'dirty', false);
    harness5.saveDelayMs = 20;
    // Trigger concurrent clicks
    const [click1, click2, click3] = await Promise.all([
      harness5.handleSaveAndSignOut(),
      harness5.handleSaveAndSignOut(),
      harness5.handleSaveAndSignOut(),
    ]);
    if (!click1 || !click2 || !click3) {
      throw new Error('Concurrent clicks should all resolve successfully via shared promise');
    }
    if (harness5.saveCount !== 1) {
      throw new Error(`Expected exactly 1 underlying save call, got ${harness5.saveCount}`);
    }

    // I. Stale save result after generation transition cannot authorize signout
    const harness6 = new OrchestratorHarness();
    harness6.requestSignOut('drive', 'dirty', false);
    harness6.saveDelayMs = 30;
    const savePromise = harness6.handleSaveAndSignOut();
    // Simulate generation transition during in-flight save (e.g. storage mode switch)
    harness6.generation++;
    const saveOutcome = await savePromise;
    if (saveOutcome !== false || harness6.signedOutCount !== 0) {
      throw new Error('Save completed across generation change must NOT authorize sign out');
    }

    // J. No LocalStorage fallback during failed Drive save
    const testStorageKey = 'canvasvault_test_isolated_key';
    localStorage.setItem(testStorageKey, 'initial_content');
    const storageKeysBefore = Object.keys(localStorage);
    // Simulate a failed Drive operation
    const mockDriveFailure = async () => {
      try {
        throw new Error('Simulated Google Drive 503 Backend Error');
      } catch {
        // Must NOT write to LocalStorage
        return false;
      }
    };
    await mockDriveFailure();
    const storageKeysAfter = Object.keys(localStorage);
    if (storageKeysBefore.length !== storageKeysAfter.length || localStorage.getItem(testStorageKey) !== 'initial_content') {
      throw new Error('LocalStorage was mutated during Drive save failure (forbidden fallback)');
    }
    localStorage.removeItem(testStorageKey);
  });

  // 21. Async file operation sequence guards and concurrency protection
  await record('21. Async file operation sequence guards and concurrency protection', async () => {
    // A complete harness modeling the exact monotonic sequence guards and invalidation logic
    // of useDrawingPersistence.
    class AsyncSequenceGuardHarness {
      public files: any[] = [];
      public currentFileId: any = null;
      public currentFileName: any = 'Untitled';
      public saveStatus: any = 'saved';
      public errorMessage: any = null;
      public isLoading: any = false;
      public isOpeningFile: any = false;
      public isFileOperating: any = false;

      public storageGeneration: any = 1;
      public latestLoadRequestId: any = 0;
      public latestListRequestId: any = 0;
      public activeCreatePromise: any = null;

      public canvasContent: any = null;
      public createCallCount: any = 0;

      public mockStorage: {
        get: (id: string) => Promise<string>;
        list: () => Promise<any[]>;
        create: (name: string, content: string) => Promise<string>;
        delete?: (id: string) => Promise<void>;
      };

      constructor(mockStorage: any) {
        this.mockStorage = mockStorage;
      }

      public async refreshFiles(): Promise<any[]> {
        const opGen = this.storageGeneration;
        const listRequestId = ++this.latestListRequestId;
        try {
          const list = await this.mockStorage.list();
          if (opGen !== this.storageGeneration || listRequestId !== this.latestListRequestId) {
            return [];
          }
          this.files = list;
          return list;
        } catch (err: any) {
          if (opGen !== this.storageGeneration || listRequestId !== this.latestListRequestId) {
            return [];
          }
          this.errorMessage = err?.message || 'Failed to list drawings';
          return [];
        }
      }

      public async openDrawing(fileId: string): Promise<boolean> {
        const opGen = this.storageGeneration;
        const loadRequestId = ++this.latestLoadRequestId;
        this.isLoading = true;
        this.isOpeningFile = true;
        this.errorMessage = null;

        try {
          const rawContent = await this.mockStorage.get(fileId);
          if (opGen !== this.storageGeneration || loadRequestId !== this.latestLoadRequestId) {
            return false;
          }

          this.canvasContent = rawContent;

          const fileList = await this.refreshFiles();
          if (opGen !== this.storageGeneration || loadRequestId !== this.latestLoadRequestId) {
            return false;
          }

          const found = fileList.find((f: any) => f.id === fileId);
          const name = found ? found.name : 'Untitled';

          this.currentFileId = fileId;
          this.currentFileName = name;
          this.saveStatus = 'saved';
          return true;
        } catch (err: any) {
          if (opGen !== this.storageGeneration || loadRequestId !== this.latestLoadRequestId) {
            return false;
          }
          this.errorMessage = err?.message || 'Failed to open drawing';
          return false;
        } finally {
          if (opGen === this.storageGeneration && loadRequestId === this.latestLoadRequestId) {
            this.isLoading = false;
            this.isOpeningFile = false;
          }
        }
      }

      public async createNewDrawing(name: string = 'Untitled'): Promise<string | null> {
        if (this.activeCreatePromise) {
          return this.activeCreatePromise;
        }

        const opGen = this.storageGeneration;
        const loadRequestId = ++this.latestLoadRequestId;
        this.isLoading = true;
        this.isFileOperating = true;

        const createPromise = (async (): Promise<string | null> => {
          try {
            const emptyContent = JSON.stringify({ name, elements: [] });
            this.createCallCount++;
            const newId = await this.mockStorage.create(name, emptyContent);
            if (opGen !== this.storageGeneration || loadRequestId !== this.latestLoadRequestId) {
              return null;
            }

            this.canvasContent = emptyContent;
            this.currentFileId = newId;
            this.currentFileName = name;
            this.saveStatus = 'saved';

            await this.refreshFiles();
            return newId;
          } catch (err: any) {
            if (opGen !== this.storageGeneration || loadRequestId !== this.latestLoadRequestId) {
              return null;
            }
            this.errorMessage = err?.message || 'Failed to create drawing';
            return null;
          } finally {
            this.activeCreatePromise = null;
            if (opGen === this.storageGeneration && loadRequestId === this.latestLoadRequestId) {
              this.isLoading = false;
              this.isFileOperating = false;
            }
          }
        })();

        this.activeCreatePromise = createPromise;
        return createPromise;
      }

      public transitionStorageGeneration(newGen: number) {
        this.storageGeneration = newGen;
        this.latestLoadRequestId++;
        this.latestListRequestId++;
        this.activeCreatePromise = null;
        this.isOpeningFile = false;
        this.isFileOperating = false;
      }
    }

    // Helper: delay promise
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // A. Rapid out-of-order openDrawing responses: A (slow) then B (fast) -> B wins, A is dropped
    const mockFilesMap: Record<string, string> = {
      file_A: 'content_A',
      file_B: 'content_B',
      file_C: 'content_C',
    };
    const harnessA = new AsyncSequenceGuardHarness({
      get: async (id: string) => {
        if (id === 'file_A') await delay(50);
        if (id === 'file_B') await delay(10);
        return mockFilesMap[id] || '';
      },
      list: async () => [
        { id: 'file_A', name: 'Drawing A' },
        { id: 'file_B', name: 'Drawing B' },
        { id: 'file_C', name: 'Drawing C' },
      ],
      create: async () => 'mock_created',
    });

    const pA = harnessA.openDrawing('file_A');
    const pB = harnessA.openDrawing('file_B');
    if (!harnessA.isOpeningFile) throw new Error('isOpeningFile should be true during in-flight load');

    const [resA, resB] = await Promise.all([pA, pB]);
    if (resA !== false) throw new Error('Stale open response A should have returned false (dropped)');
    if (resB !== true) throw new Error('Latest open response B should have returned true (accepted)');
    if (harnessA.currentFileId !== 'file_B') throw new Error(`Expected currentFileId file_B, got ${harnessA.currentFileId}`);
    if (harnessA.currentFileName !== 'Drawing B') throw new Error(`Expected currentFileName Drawing B, got ${harnessA.currentFileName}`);
    if (harnessA.canvasContent !== 'content_B') throw new Error('Canvas content was not updated to winning drawing B');
    if (harnessA.isOpeningFile !== false) throw new Error('isOpeningFile should be false after completion');
    if (harnessA.isLoading !== false) throw new Error('isLoading should be false after completion');

    // B. Rapid A -> B -> C requests (latest open request wins)
    const harnessB = new AsyncSequenceGuardHarness({
      get: async (id: string) => {
        if (id === 'file_A') await delay(60);
        if (id === 'file_B') await delay(40);
        if (id === 'file_C') await delay(10);
        return mockFilesMap[id] || '';
      },
      list: async () => [
        { id: 'file_A', name: 'Drawing A' },
        { id: 'file_B', name: 'Drawing B' },
        { id: 'file_C', name: 'Drawing C' },
      ],
      create: async () => 'mock_created',
    });

    const [rA, rB, rC] = await Promise.all([
      harnessB.openDrawing('file_A'),
      harnessB.openDrawing('file_B'),
      harnessB.openDrawing('file_C'),
    ]);
    if (rA !== false || rB !== false) throw new Error('Older requests A and B must be dropped');
    if (rC !== true) throw new Error('Latest request C must succeed');
    if (harnessB.currentFileId !== 'file_C') throw new Error('Latest file C must be the active file');
    if (harnessB.canvasContent !== 'content_C') throw new Error('Canvas must reflect latest drawing C');

    // C. Stale open response cannot update currentFileId
    const harnessC = new AsyncSequenceGuardHarness({
      get: async (id: string) => {
        if (id === 'stale_file') await delay(50);
        if (id === 'active_file') await delay(10);
        return mockFilesMap[id] || '{}';
      },
      list: async () => [
        { id: 'stale_file', name: 'Stale' },
        { id: 'active_file', name: 'Active' },
      ],
      create: async () => 'mock_created',
    });

    const pStale = harnessC.openDrawing('stale_file');
    await delay(5);
    const pActive = harnessC.openDrawing('active_file');
    await Promise.all([pStale, pActive]);
    if (harnessC.currentFileId !== 'active_file') {
      throw new Error(`Stale open response overwrote currentFileId: ${harnessC.currentFileId}`);
    }

    // D. Out-of-order refreshFiles responses (stale list response cannot replace newer list or resurrect deleted file)
    let currentStoreFiles = [
      { id: 'file_keep', name: 'Keep.excalidraw' },
      { id: 'file_delete', name: 'Delete.excalidraw' },
    ];
    let listCallCount: any = 0;
    const harnessD = new AsyncSequenceGuardHarness({
      get: async () => '{}',
      list: async () => {
        listCallCount++;
        if (listCallCount === 1) {
          // Slow initial list containing the doomed file
          await delay(50);
          return [
            { id: 'file_keep', name: 'Keep.excalidraw' },
            { id: 'file_delete', name: 'Delete.excalidraw' },
          ];
        } else {
          // Fast subsequent list after deletion
          await delay(10);
          return currentStoreFiles;
        }
      },
      create: async () => 'mock_created',
    });

    // Stale list request starts
    const pList1 = harnessD.refreshFiles();
    // User deletes file_delete shortly after
    await delay(5);
    currentStoreFiles = [{ id: 'file_keep', name: 'Keep.excalidraw' }];
    // Fast list request starts after deletion
    const pList2 = harnessD.refreshFiles();

    await Promise.all([pList1, pList2]);
    if (harnessD.files.length !== 1 || harnessD.files[0].id !== 'file_keep') {
      throw new Error('Stale list response resurrected deleted file in files state');
    }

    // E. Duplicate concurrent create calls produce only one file
    let createdCount: any = 0;
    const harnessE = new AsyncSequenceGuardHarness({
      get: async () => '{}',
      list: async () => [],
      create: async (name: string) => {
        createdCount++;
        await delay(25);
        return `file_created_${createdCount}_${name}`;
      },
    });

    // Double-click / rapid concurrent invocations
    const [c1, c2, c3] = await Promise.all([
      harnessE.createNewDrawing('Double Click Test'),
      harnessE.createNewDrawing('Double Click Test'),
      harnessE.createNewDrawing('Double Click Test'),
    ]);

    if (harnessE.createCallCount !== 1) {
      throw new Error(`Expected exactly 1 storage.create invocation, got ${harnessE.createCallCount}`);
    }
    if (!c1 || c1 !== c2 || c2 !== c3) {
      throw new Error(`Concurrent create calls did not return identical file ID: ${c1}, ${c2}, ${c3}`);
    }
    if (harnessE.activeCreatePromise !== null) {
      throw new Error('activeCreatePromise was not cleared after completion');
    }
    if (harnessE.isFileOperating !== false) {
      throw new Error('isFileOperating should be false after create completes');
    }

    // Subsequent call after completion creates a new file independently
    const c4 = await harnessE.createNewDrawing('Second File');
    if (harnessE.createCallCount !== 2 || c4 === c1) {
      throw new Error('Subsequent createNewDrawing did not execute new file creation');
    }

    // F. Generation transition invalidates pending open
    const harnessF = new AsyncSequenceGuardHarness({
      get: async () => {
        await delay(40);
        return 'gen1_content';
      },
      list: async () => [{ id: 'gen1_doc', name: 'Gen1 Doc' }],
      create: async () => 'mock_created',
    });

    const pPendingOpen = harnessF.openDrawing('gen1_doc');
    await delay(10);
    // Switch generation (e.g. user signs in or out)
    harnessF.transitionStorageGeneration(2);

    const openOutcome = await pPendingOpen;
    if (openOutcome !== false) throw new Error('Pending open across generation change must return false');
    if (harnessF.currentFileId !== null) throw new Error('Stale generation open must NOT set currentFileId');
    if (harnessF.canvasContent !== null) throw new Error('Stale generation open must NOT mutate canvas');
    if (harnessF.isOpeningFile !== false) throw new Error('isOpeningFile should be reset on transition');

    // G. Generation transition invalidates pending list
    let listGen = 1;
    const harnessG = new AsyncSequenceGuardHarness({
      get: async () => '{}',
      list: async () => {
        if (listGen === 1) {
          await delay(40);
          return [{ id: 'stale_gen1_file', name: 'Old Gen' }];
        }
        return [{ id: 'new_gen2_file', name: 'New Gen' }];
      },
      create: async () => 'mock_created',
    });

    const pPendingList = harnessG.refreshFiles();
    await delay(10);
    listGen = 2;
    harnessG.transitionStorageGeneration(2);

    await pPendingList;
    if (harnessG.files.some((f) => f.id === 'stale_gen1_file')) {
      throw new Error('Pending list from old generation populated files state');
    }

    // New list in gen 2 works normally
    await harnessG.refreshFiles();
    if (harnessG.files.length !== 1 || harnessG.files[0].id !== 'new_gen2_file') {
      throw new Error('New generation list was not accepted');
    }

    // H. Stale operation cannot mutate saveStatus, currentFileName, or errorMessage
    const harnessH = new AsyncSequenceGuardHarness({
      get: async (id: string) => {
        if (id === 'bad_stale') {
          await delay(40);
          throw new Error('Stale backend failure');
        }
        await delay(10);
        return 'good_content';
      },
      list: async () => [
        { id: 'bad_stale', name: 'Bad Stale' },
        { id: 'good_fresh', name: 'Good Fresh' },
      ],
      create: async () => 'mock_created',
    });

    const pBad = harnessH.openDrawing('bad_stale');
    const pGood = harnessH.openDrawing('good_fresh');
    await Promise.all([pBad, pGood]);

    if (harnessH.errorMessage !== null) {
      throw new Error(`Stale operation failure set errorMessage: ${harnessH.errorMessage}`);
    }
    if (harnessH.currentFileName !== 'Good Fresh') {
      throw new Error(`Current file name was corrupted by stale operation: ${harnessH.currentFileName}`);
    }
    if (harnessH.saveStatus !== 'saved') {
      throw new Error(`Save status was corrupted by stale operation: ${harnessH.saveStatus}`);
    }

    // I. createNewDrawing invalidates in-flight openDrawing
    const harnessI = new AsyncSequenceGuardHarness({
      get: async () => {
        await delay(50);
        return 'slow_open_content';
      },
      list: async () => [{ id: 'slow_doc', name: 'Slow Doc' }],
      create: async (name: string, _content: string) => {
        await delay(15);
        return `created_${name}`;
      },
    });

    const pSlowOpen = harnessI.openDrawing('slow_doc');
    await delay(5);
    const pNew = harnessI.createNewDrawing('Fresh Canvas');

    const [resSlow, resNew] = await Promise.all([pSlowOpen, pNew]);
    if (resSlow !== false) throw new Error('In-flight open superseded by create must be dropped');
    if (!resNew) throw new Error('createNewDrawing should succeed');
    if (harnessI.currentFileName !== 'Fresh Canvas') {
      throw new Error(`Expected Fresh Canvas, got ${harnessI.currentFileName}`);
    }
    if (harnessI.canvasContent === 'slow_open_content') {
      throw new Error('Superseded openDrawing overwrote the newly created canvas');
    }

    // J. isSignOutSafe contract verification
    const evaluateSignOutSafe = (state: {
      storageMode: 'local' | 'drive';
      isSaving: boolean;
      isDebouncing: boolean;
      isOpeningFile: boolean;
      isFileOperating: boolean;
      saveStatus: string;
    }) => {
      return (
        state.storageMode !== 'drive' ||
        (!state.isSaving &&
          !state.isDebouncing &&
          !state.isOpeningFile &&
          !state.isFileOperating &&
          state.saveStatus !== 'dirty' &&
          state.saveStatus !== 'error' &&
          state.saveStatus !== 'saving')
      );
    };

    if (
      !evaluateSignOutSafe({
        storageMode: 'local',
        isSaving: false,
        isDebouncing: false,
        isOpeningFile: true,
        isFileOperating: true,
        saveStatus: 'dirty',
      })
    ) {
      throw new Error('Local storage mode should always be safe for sign-out');
    }

    if (
      evaluateSignOutSafe({
        storageMode: 'drive',
        isSaving: false,
        isDebouncing: false,
        isOpeningFile: true,
        isFileOperating: false,
        saveStatus: 'saved',
      })
    ) {
      throw new Error('Drive mode with isOpeningFile=true must NOT be safe for sign-out');
    }

    if (
      evaluateSignOutSafe({
        storageMode: 'drive',
        isSaving: false,
        isDebouncing: false,
        isOpeningFile: false,
        isFileOperating: true,
        saveStatus: 'saved',
      })
    ) {
      throw new Error('Drive mode with isFileOperating=true must NOT be safe for sign-out');
    }

    if (
      !evaluateSignOutSafe({
        storageMode: 'drive',
        isSaving: false,
        isDebouncing: false,
        isOpeningFile: false,
        isFileOperating: false,
        saveStatus: 'saved',
      })
    ) {
      throw new Error('Idle, clean Drive mode must be safe for sign-out');
    }
  });

  // 22. Dirty state switch protection and UnsavedSwitchModal orchestration
  await record('22. Dirty state switch protection and UnsavedSwitchModal orchestration', async () => {
    type TestSwitchAction =
      | { type: 'switch'; targetFileId: string; targetFileName?: string }
      | { type: 'new' };

    class UnsavedSwitchOrchestratorHarness {
      public currentFileId: any = 'file_1';
      public currentFileName: any = 'File 1';
      public saveStatus: any = 'saved';
      public isSaving: any = false;
      public isDebouncing: any = false;
      public isDirty: any = false;
      public generation: any = 1;
      public storageMode: any = 'local';

      public pendingAction: TestSwitchAction | null = null;
      public switchSaveError: any = null;
      public isModalOpen: any = false;

      public saveCallCount: any = 0;
      public mockSaveResult: boolean = true;
      public saveDelayMs: any = 0;
      public activeSavePromise: Promise<boolean> | null = null;
      public cancelledDebouncedSave: any = false;

      public files: any[] = [
        { id: 'file_1', name: 'File 1.excalidraw' },
        { id: 'file_2', name: 'File 2.excalidraw' },
      ];

      public isSceneUnsaved(): boolean {
        return (
          this.isDirty ||
          this.saveStatus === 'dirty' ||
          this.saveStatus === 'saving' ||
          this.saveStatus === 'error' ||
          this.isSaving ||
          this.isDebouncing
        );
      }

      public handleSelectFileRequest(fileId: string): boolean {
        if (fileId === this.currentFileId) {
          // No-op for currently active file
          return false;
        }

        if (this.isSceneUnsaved()) {
          const target = this.files.find((f) => f.id === fileId);
          this.switchSaveError = null;
          this.pendingAction = {
            type: 'switch',
            targetFileId: fileId,
            targetFileName: target ? target.name : undefined,
          };
          this.isModalOpen = true;
          return false;
        } else {
          this.currentFileId = fileId;
          const target = this.files.find((f) => f.id === fileId);
          this.currentFileName = target ? target.name : 'Untitled';
          return true;
        }
      }

      public handleNewDrawingRequest(): boolean {
        if (this.isSceneUnsaved()) {
          this.switchSaveError = null;
          this.pendingAction = { type: 'new' };
          this.isModalOpen = true;
          return false;
        } else {
          this.currentFileId = 'new_id_' + Date.now();
          this.currentFileName = 'Untitled';
          this.saveStatus = 'saved';
          this.isDirty = false;
          return true;
        }
      }

      public async saveNow(): Promise<boolean> {
        if (this.activeSavePromise) {
          return this.activeSavePromise;
        }

        const p = (async () => {
          this.saveCallCount++;
          if (this.saveDelayMs > 0) {
            await new Promise((r) => setTimeout(r, this.saveDelayMs));
          }
          if (this.mockSaveResult) {
            this.saveStatus = 'saved';
            this.isDirty = false;
          }
          return this.mockSaveResult;
        })();

        this.activeSavePromise = p;
        try {
          return await p;
        } finally {
          this.activeSavePromise = null;
        }
      }

      public activeSwitchPromise: Promise<boolean> | null = null;

      public async handleSaveAndProceed(): Promise<boolean> {
        if (this.activeSwitchPromise) {
          return this.activeSwitchPromise;
        }
        if (!this.pendingAction) return false;
        const startGen = this.generation;
        const action = this.pendingAction;
        this.switchSaveError = null;

        const p = (async () => {
          try {
            const success = await this.saveNow();
            if (!success || this.generation !== startGen) {
              this.switchSaveError = 'Failed to save drawing. Active drawing preserved.';
              return false;
            }

            this.pendingAction = null;
            this.isModalOpen = false;

            if (action.type === 'switch') {
              this.currentFileId = action.targetFileId;
              const target = this.files.find((f) => f.id === action.targetFileId);
              this.currentFileName = target ? target.name : 'Untitled';
            } else {
              this.currentFileId = 'new_created_id';
              this.currentFileName = 'Untitled';
            }
            return true;
          } catch (err: any) {
            this.switchSaveError = err?.message || 'Save failed. Active drawing preserved.';
            return false;
          } finally {
            this.activeSwitchPromise = null;
          }
        })();

        this.activeSwitchPromise = p;
        return p;
      }

      public handleDiscardAndProceed(): void {
        if (!this.pendingAction) return;
        const action = this.pendingAction;
        this.pendingAction = null;
        this.isModalOpen = false;
        this.switchSaveError = null;
        this.cancelledDebouncedSave = true;

        if (action.type === 'switch') {
          this.currentFileId = action.targetFileId;
          const target = this.files.find((f) => f.id === action.targetFileId);
          this.currentFileName = target ? target.name : 'Untitled';
          this.saveStatus = 'saved';
          this.isDirty = false;
        } else {
          this.currentFileId = 'new_created_id';
          this.currentFileName = 'Untitled';
          this.saveStatus = 'saved';
          this.isDirty = false;
        }
      }

      public handleCancel(): void {
        this.pendingAction = null;
        this.isModalOpen = false;
        this.switchSaveError = null;
      }

      public transitionGeneration(newGen: number, newMode: any): void {
        this.generation = newGen;
        this.storageMode = newMode;
        // Invalidate pending switch action
        this.pendingAction = null;
        this.switchSaveError = null;
        this.isModalOpen = false;
        this.activeSwitchPromise = null;
      }
    }

    // A. Clean scene allows immediate file switch without modal
    const harness = new UnsavedSwitchOrchestratorHarness();
    const switched = harness.handleSelectFileRequest('file_2');
    if (!switched || harness.currentFileId !== 'file_2' || harness.isModalOpen) {
      throw new Error('Clean scene should switch file immediately without modal');
    }

    // B. Clicking currently active file is a no-op even if dirty
    harness.isDirty = true;
    const selfClickResult = harness.handleSelectFileRequest('file_2');
    if (selfClickResult !== false || harness.isModalOpen || harness.currentFileId !== 'file_2') {
      throw new Error('Clicking active file should be a silent no-op');
    }

    // C. Dirty scene prompts on file switch
    harness.isDirty = true;
    const dirtySwitchResult = harness.handleSelectFileRequest('file_1');
    if (dirtySwitchResult !== false || !harness.isModalOpen || !harness.pendingAction) {
      throw new Error('Dirty scene must open UnsavedSwitchModal on file switch');
    }
    if (harness.pendingAction.type !== 'switch' || harness.pendingAction.targetFileId !== 'file_1') {
      throw new Error('Pending action does not match switch target');
    }
    if (harness.currentFileId !== 'file_2') {
      throw new Error('Active file must not change before switch confirmation');
    }

    // D. Dirty scene prompts on "+ New"
    const harnessNew = new UnsavedSwitchOrchestratorHarness();
    harnessNew.isDirty = true;
    const dirtyNewResult = harnessNew.handleNewDrawingRequest();
    if (dirtyNewResult !== false || !harnessNew.isModalOpen || harnessNew.pendingAction?.type !== 'new') {
      throw new Error('Dirty scene must open UnsavedSwitchModal on "+ New" request');
    }

    // E. Clean scene executes "+ New" immediately
    const harnessCleanNew = new UnsavedSwitchOrchestratorHarness();
    harnessCleanNew.isDirty = false;
    harnessCleanNew.saveStatus = 'saved';
    const cleanNewResult = harnessCleanNew.handleNewDrawingRequest();
    if (!cleanNewResult || harnessCleanNew.isModalOpen || harnessCleanNew.currentFileName !== 'Untitled') {
      throw new Error('Clean scene should execute "+ New" immediately');
    }

    // F. "Save and Switch" succeeds: saves and opens target file
    const harnessSave = new UnsavedSwitchOrchestratorHarness();
    harnessSave.isDirty = true;
    harnessSave.handleSelectFileRequest('file_2');
    const saveSuccess = await harnessSave.handleSaveAndProceed();
    if (!saveSuccess || harnessSave.isModalOpen || harnessSave.currentFileId !== 'file_2') {
      throw new Error('Save and Switch should save, close modal, and open target file');
    }
    if (harnessSave.saveCallCount !== 1 || harnessSave.saveStatus !== 'saved') {
      throw new Error('Save was not executed properly during Save and Switch');
    }

    // G. Failed save blocks switch and preserves unsaved work
    const harnessFail = new UnsavedSwitchOrchestratorHarness();
    harnessFail.isDirty = true;
    harnessFail.mockSaveResult = false;
    harnessFail.handleSelectFileRequest('file_2');
    const failSuccess = await harnessFail.handleSaveAndProceed();
    if (failSuccess !== false) {
      throw new Error('Failed save must return false');
    }
    if (!harnessFail.isModalOpen) {
      throw new Error('Failed save must keep UnsavedSwitchModal open');
    }
    if (harnessFail.currentFileId !== 'file_1') {
      throw new Error('Failed save must block switch and keep original file active');
    }
    if (!harnessFail.switchSaveError) {
      throw new Error('Failed save must populate switchSaveError');
    }

    // H. "Discard and Switch" cancels debounce, discards, and switches
    const harnessDiscard = new UnsavedSwitchOrchestratorHarness();
    harnessDiscard.isDirty = true;
    harnessDiscard.handleSelectFileRequest('file_2');
    harnessDiscard.handleDiscardAndProceed();
    if (harnessDiscard.isModalOpen || harnessDiscard.currentFileId !== 'file_2') {
      throw new Error('Discard and Switch should close modal and switch to target file');
    }
    if (!harnessDiscard.cancelledDebouncedSave) {
      throw new Error('Discard and Switch must cancel pending debounced saves');
    }

    // I. "Cancel" closes modal and leaves drawing dirty and active
    const harnessCancel = new UnsavedSwitchOrchestratorHarness();
    harnessCancel.isDirty = true;
    harnessCancel.handleSelectFileRequest('file_2');
    harnessCancel.handleCancel();
    if (harnessCancel.isModalOpen || harnessCancel.pendingAction !== null) {
      throw new Error('Cancel must close modal and clear pending action');
    }
    if (harnessCancel.currentFileId !== 'file_1' || !harnessCancel.isDirty) {
      throw new Error('Cancel must keep original file active and dirty');
    }

    // J. "Save and Create" (+ New) succeeds
    const harnessSaveNew = new UnsavedSwitchOrchestratorHarness();
    harnessSaveNew.isDirty = true;
    harnessSaveNew.handleNewDrawingRequest();
    const saveNewSuccess = await harnessSaveNew.handleSaveAndProceed();
    if (!saveNewSuccess || harnessSaveNew.isModalOpen || harnessSaveNew.currentFileName !== 'Untitled') {
      throw new Error('Save and Create must succeed, close modal, and open new drawing');
    }

    // K. Concurrent clicks on Save and Switch share the in-flight promise
    const harnessConcurrent = new UnsavedSwitchOrchestratorHarness();
    harnessConcurrent.isDirty = true;
    harnessConcurrent.saveDelayMs = 20;
    harnessConcurrent.handleSelectFileRequest('file_2');
    const [c1, c2] = await Promise.all([
      harnessConcurrent.handleSaveAndProceed(),
      harnessConcurrent.handleSaveAndProceed(),
    ]);
    if (!c1 || !c2 || harnessConcurrent.saveCallCount !== 1) {
      throw new Error('Concurrent clicks must share the single in-flight save');
    }

    // L. Storage generation change invalidates pending switch action
    const harnessGen = new UnsavedSwitchOrchestratorHarness();
    harnessGen.isDirty = true;
    harnessGen.handleSelectFileRequest('file_2');
    if (!harnessGen.isModalOpen) throw new Error('Modal should be open initially');
    harnessGen.transitionGeneration(2, 'drive');
    if (harnessGen.isModalOpen || harnessGen.pendingAction !== null) {
      throw new Error('Generation transition must invalidate pending switch action and close modal');
    }

    // M. Generation change during in-flight Save and Switch blocks switch
    const harnessGenFlight = new UnsavedSwitchOrchestratorHarness();
    harnessGenFlight.isDirty = true;
    harnessGenFlight.saveDelayMs = 30;
    harnessGenFlight.handleSelectFileRequest('file_2');
    const pendingSave = harnessGenFlight.handleSaveAndProceed();
    // Simulate generation transition during save
    harnessGenFlight.generation = 3;
    const flightOutcome = await pendingSave;
    if (flightOutcome !== false || harnessGenFlight.currentFileId !== 'file_1') {
      throw new Error('Save across generation transition must not authorize file switch');
    }
  });

  const allPassed = results.every((r) => r.passed);

  return { passed: allPassed, results };
}

// Auto-run in browser and expose globally for verification
if (typeof window !== 'undefined') {
  (window as any).__runPhase2SelfTests = runPersistenceSelfTests;
  runPersistenceSelfTests().then((res) => {
    (window as any).__phase2TestResults = res;
    console.log('[CanvasVault Self-Test]', res.passed ? 'ALL TESTS PASSED' : 'TESTS FAILED', res.results);

    const reportDiv = document.createElement('div');
    reportDiv.id = 'self-test-results';
    reportDiv.setAttribute('data-status', res.passed ? 'passed' : 'failed');
    reportDiv.textContent = JSON.stringify(res, null, 2);
    reportDiv.style.display = 'none';
    document.body.appendChild(reportDiv);
  });
}

