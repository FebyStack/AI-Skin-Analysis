// On-device store for the installed PWA. IndexedDB (no external deps) with named
// "folders" (object stores) mapping to the concepts a user would recognise:
//
//   scans    — persisted scan metadata + report, keyed by server scan id
//   images   — captured jpegs, keyed by "<scanId>::<angle>" (angle="closeup" for lesions)
//   pending  — scans awaiting sync to Postgres (autoIncrement id)
//
// Postgres remains the authoritative store; this is a per-device cache/queue.

export const DB_NAME = "skin-analysis";
export const DB_VERSION = 1;
export const STORE_SCANS = "scans";
export const STORE_IMAGES = "images";
export const STORE_PENDING = "pending";

export interface StoredScan {
  id: string;                // server scan id (or generated for offline-first scans)
  kind: "face" | "lesion";
  createdAt: number;
  report: unknown;           // FaceReport or LesionScanReport (structural, JSON-safe)
  synced: boolean;           // true = present in Postgres
  patientId?: string;        // selected patient at scan time ("walk-in" if none)
}

export interface StoredImage {
  scanId: string;
  angle: string;             // "front"/"left-45"/... for face; "closeup" for lesion
  jpeg: Blob;                // stored as JPEG blob (spec requirement)
  createdAt: number;
}

export interface PendingScan {
  id?: number;               // autoIncrement
  kind: "face" | "lesion";
  createdAt: number;
  payload: unknown;          // exactly what saveFaceScan / analyzeLesion would send
  imageIds: string[];        // links to image rows above (scanId::angle keys)
  lastError?: string;
}

// Lazy singleton so callers don't have to manage the handle.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SCANS)) {
        const store = db.createObjectStore(STORE_SCANS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: ["scanId", "angle"] });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onerror = () => reject(req.error ?? new Error("failed to open IndexedDB"));
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("tx failed"));
      }),
  );
}

// ---------- scans ----------

export function putScan(scan: StoredScan): Promise<IDBValidKey> {
  return tx(STORE_SCANS, "readwrite", (s) => s.put(scan));
}

export function getScan(id: string): Promise<StoredScan | undefined> {
  return tx(STORE_SCANS, "readonly", (s) => s.get(id));
}

export function listScans(): Promise<StoredScan[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredScan[]>((resolve, reject) => {
        const req = db.transaction(STORE_SCANS, "readonly").objectStore(STORE_SCANS).getAll();
        req.onsuccess = () =>
          resolve((req.result as StoredScan[]).sort((a, b) => b.createdAt - a.createdAt));
        req.onerror = () => reject(req.error);
      }),
  );
}

export function removeScan(id: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction([STORE_SCANS, STORE_IMAGES], "readwrite");
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.objectStore(STORE_SCANS).delete(id);
        // Cascade: clear any images whose composite key starts with this scan id.
        const imgs = t.objectStore(STORE_IMAGES);
        const range = IDBKeyRange.bound([id, ""], [id, "￿"]);
        const cur = imgs.openCursor(range);
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            c.delete();
            c.continue();
          }
        };
      }),
  );
}

// ---------- images (JPEG blobs) ----------

export function putImage(img: StoredImage): Promise<IDBValidKey> {
  return tx(STORE_IMAGES, "readwrite", (s) => s.put(img));
}

export function getImage(scanId: string, angle: string): Promise<StoredImage | undefined> {
  return tx(STORE_IMAGES, "readonly", (s) => s.get([scanId, angle]));
}

export function listImagesFor(scanId: string): Promise<StoredImage[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredImage[]>((resolve, reject) => {
        const out: StoredImage[] = [];
        const t = db.transaction(STORE_IMAGES, "readonly");
        const range = IDBKeyRange.bound([scanId, ""], [scanId, "￿"]);
        const cur = t.objectStore(STORE_IMAGES).openCursor(range);
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            out.push(c.value as StoredImage);
            c.continue();
          } else resolve(out);
        };
        cur.onerror = () => reject(cur.error);
      }),
  );
}

// ---------- pending queue ----------

export function enqueuePending(item: Omit<PendingScan, "id">): Promise<number> {
  return tx(STORE_PENDING, "readwrite", (s) => s.add(item)).then((k) => Number(k));
}

export function listPending(): Promise<PendingScan[]> {
  return openDb().then(
    (db) =>
      new Promise<PendingScan[]>((resolve, reject) => {
        const req = db.transaction(STORE_PENDING, "readonly").objectStore(STORE_PENDING).getAll();
        req.onsuccess = () => resolve(req.result as PendingScan[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function removePending(id: number): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const req = db.transaction(STORE_PENDING, "readwrite").objectStore(STORE_PENDING).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

export function updatePending(item: PendingScan): Promise<IDBValidKey> {
  return tx(STORE_PENDING, "readwrite", (s) => s.put(item));
}

// Ask the browser to make our storage persistent — resists eviction on low disk.
// Best-effort; no exception if unsupported.
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
