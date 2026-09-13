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
