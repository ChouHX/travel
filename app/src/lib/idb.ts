/**
 * 打卡点照片存储。
 *
 * 用 IndexedDB 而不是 localStorage：localStorage 只有 5–10MB 且只能存字符串，
 * 一张压缩后的 WebP 就有 100–300KB，几张就撑爆；IndexedDB 可直接存 Blob，容量按磁盘算。
 */
const DB_NAME = 'ubr-map-photos'
const DB_VERSION = 1
const STORE = 'photos'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  await tx('readwrite', (s) => s.put(blob, id))
}

export async function getPhoto(id: string): Promise<Blob | null> {
  const v = await tx<Blob | undefined>('readonly', (s) => s.get(id))
  return v ?? null
}

export async function deletePhoto(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

export async function clearPhotos(): Promise<void> {
  await tx('readwrite', (s) => s.clear())
}

/** 批量取回，用于列表缩略图 */
export async function getPhotos(ids: string[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>()
  await Promise.all(
    ids.map(async (id) => {
      try {
        const b = await getPhoto(id)
        if (b) out.set(id, b)
      } catch {
        /* 单张失败不影响其它 */
      }
    }),
  )
  return out
}

/** 统计占用，管理页展示用 */
export async function photoStats(): Promise<{ count: number; bytes: number }> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const store = t.objectStore(STORE)
    let count = 0
    let bytes = 0
    const cursor = store.openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (c) {
        count += 1
        const v = c.value as Blob
        bytes += v?.size ?? 0
        c.continue()
      } else {
        resolve({ count, bytes })
      }
    }
    cursor.onerror = () => reject(cursor.error)
  })
}
