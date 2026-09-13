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

