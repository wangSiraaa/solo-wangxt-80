/** IndexedDB 本地工程存取，无后端。 */

const DB_NAME = 'origami-preview';
const STORE = 'projects';
const VERSION = 1;

export interface ProjectRecord {
  id: string;
  title: string;
  updatedAt: number;
  /** 可直接再次载入的 FOLD（含自定义折痕身份/自动角命名空间） */
  fold: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveProject(rec: ProjectRecord): Promise<void> {
  await tx('readwrite', (store) => store.put(rec));
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await tx('readonly', (store) => store.getAll());
  return (all as ProjectRecord[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
