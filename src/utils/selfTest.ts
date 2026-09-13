import { serializeDrawing, deserializeDrawing, ensureExcalidrawExtension, stripExcalidrawExtension, isValidExcalidrawJson } from './excalidrawSerialization';
import { LocalStorageAdapter } from '../storage/localStorageAdapter';
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

  // 9. Folder cache invalidation on 404 vs preservation on 403/429/500
  const { GoogleDriveError } = await import('../storage/googleDriveErrors');
  await record('9. Google Drive: Folder cache invalidation policy', async () => {
    let folderLookups: number = 0;

    const mockFetch = createMockFetch((url, init) => {
      if (url.includes('/drive/v3/files?') && (!init || !init.method || init.method === 'GET')) {
        folderLookups++;
        return jsonResponse(200, { files: [{ id: 'folder_resilient' }] });
      }
      if (url.includes('/test-403')) {
        return jsonResponse(403, { error: 'forbidden' });
      }
      if (url.includes('/test-404')) {
        return jsonResponse(404, { error: 'not_found' });
      }
      return jsonResponse(200, {});
    });

    const client = new GoogleDriveClient({
      getToken: () => MOCK_TOKEN,
      fetchFn: mockFetch,
    });

    // 1st lookup: discovers folder
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 1) throw new Error(`Expected 1 lookup, got ${folderLookups}`);

    // 2nd lookup: cache hit
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 1) throw new Error(`Cache hit failed, lookup count is ${folderLookups}`);

    // 403 error: should NOT invalidate cache
    try {
      await (client as any).authenticatedFetch('https://example.com/test-403');
    } catch {
      // Expected
    }
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 1) throw new Error(`403 should not invalidate folder cache`);

    // 404 error: SHOULD invalidate cache
    try {
      await (client as any).authenticatedFetch('https://example.com/test-404');
    } catch {
      // Expected
    }
    await client.getOrCreateFolder();
    if ((folderLookups as number) !== 2) throw new Error(`404 should have invalidated folder cache`);
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

