import type { DrawingFile, DrawingStorage } from './types';
import { isValidExcalidrawJson } from '../utils/excalidrawSerialization';

export type MigrationItemStatus = 'imported' | 'skipped' | 'failed';

export interface MigrationItemResult {
  localId: string;
  name: string;
  status: MigrationItemStatus;
  driveFileId?: string;
  errorMessage?: string;
}

export interface MigrationSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: MigrationItemResult[];
}

export interface MigrationDriveTarget {
  createWithProperties(
    name: string,
    content: string,
    extraAppProperties?: Record<string, string>
  ): Promise<string>;
  list(): Promise<DrawingFile[]>;
  listWithProperties?(): Promise<Array<DrawingFile & { appProperties?: Record<string, string> }>>;
}

export interface MigrationOptions {
  localStorage: DrawingStorage;
  driveStorage: MigrationDriveTarget;
  now?: () => string;
}

/**
 * Explicit, user-consented migration of anonymous LocalStorage drawings into Google Drive.
 * 1. Reads local drawings without mutating or deleting them.
 * 2. Validates each source drawing as valid native Excalidraw JSON.
 * 3. Enforces idempotency: skips drawings whose sourceLocalId already exists in Drive.
 * 4. Injects sourceLocalId and migratedAt metadata via createWithProperties().
 * 5. Returns structured per-file results and summary counts.
 * 6. Partial failures continue with remaining files without aborting.
 * 7. Never replaces active canvas, never silently deletes local files, never falls back to LocalStorage.
 */
export async function migrateLocalDrawingsToDrive({
  localStorage,
  driveStorage,
  now = () => new Date().toISOString(),
}: MigrationOptions): Promise<MigrationSummary> {
  const localFiles = await localStorage.list();
  if (localFiles.length === 0) {
    return {
      total: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
    };
  }

  // Inspect existing managed Drive files to ensure idempotency
  const importedLocalIds = new Set<string>();
  try {
    const driveFiles = driveStorage.listWithProperties
      ? await driveStorage.listWithProperties()
      : await driveStorage.list();

    for (const df of driveFiles) {
      const srcId = df.appProperties?.sourceLocalId;
      if (srcId) {
        importedLocalIds.add(srcId);
      }
    }
  } catch (err) {
    console.error('Failed to inspect existing Drive files for migration idempotency:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to inspect existing Drive files');
  }

  const items: MigrationItemResult[] = [];
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const localFile of localFiles) {
    // Idempotency: Skip if already migrated
    if (importedLocalIds.has(localFile.id)) {
      items.push({
        localId: localFile.id,
        name: localFile.name,
        status: 'skipped',
      });
      skippedCount++;
      continue;
    }

    try {
      // 1. Read local drawing without mutating or deleting local storage
      const content = await localStorage.get(localFile.id);

      // 2. Validate native Excalidraw JSON schema
      if (!isValidExcalidrawJson(content)) {
        items.push({
          localId: localFile.id,
          name: localFile.name,
          status: 'failed',
          errorMessage: 'Invalid or corrupt drawing schema',
        });
        failedCount++;
        continue;
      }

      // 3. Upload to Google Drive with source metadata
      const driveFileId = await driveStorage.createWithProperties(
        localFile.name,
        content,
        {
          sourceLocalId: localFile.id,
          migratedAt: now(),
        }
      );

      // Record in set to prevent intra-batch duplicates
      importedLocalIds.add(localFile.id);

      items.push({
        localId: localFile.id,
        name: localFile.name,
        status: 'imported',
        driveFileId,
      });
      importedCount++;
    } catch (err) {
      // One failed file must NOT abort the entire migration
      console.error(`Migration failed for drawing ${localFile.name}:`, err);
      items.push({
        localId: localFile.id,
        name: localFile.name,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'Upload failed',
      });
      failedCount++;
    }
  }

  return {
    total: localFiles.length,
    imported: importedCount,
    skipped: skippedCount,
    failed: failedCount,
    items,
  };
}
