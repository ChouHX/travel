/**
 * 持久层：SQLite（用 Node 内置的 node:sqlite）。
 *
 * 选它是因为不需要编译原生模块 —— better-sqlite3 之类在部署时经常卡在 node-gyp。
 * 数据文件与照片都放在 server/var/ 下，备份时整个目录拷走即可。
 */
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.UBR_DATA_DIR || path.join(__dirname, 'var')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
export const DB_PATH = path.join(DATA_DIR, 'ubr.db')

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS checkins (
    id          TEXT PRIMARY KEY,
    seq         INTEGER NOT NULL DEFAULT 0,
    name        TEXT    NOT NULL DEFAULT '',
    note        TEXT    NOT NULL DEFAULT '',
    rating      INTEGER NOT NULL DEFAULT 0,
    kind        TEXT    NOT NULL DEFAULT '其他',
    lng         REAL    NOT NULL,
    lat         REAL    NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    photo       TEXT,
    photo_type  TEXT,
    photo_w     INTEGER,
    photo_h     INTEGER,
    photo_bytes INTEGER,
    from_poi    TEXT,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_checkins_seq ON checkins(seq);

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const newId = () => crypto.randomBytes(8).toString('hex')

/** 数据库行 → 前端使用的形状（字段名与本地版保持一致，减少前端改动面） */
export function rowToCheckin(row) {
  if (!row) return null
  const hasPhoto = !!row.photo
  return {
    id: row.id,
    seq: row.seq,
    name: row.name,
    note: row.note,
    rating: row.rating,
    kind: row.kind,
    lng: row.lng,
    lat: row.lat,
    done: !!row.done,
    fromPoi: row.from_poi || undefined,
    // 带版本参数：照片被替换后 URL 会变，避免浏览器沿用旧缓存
    photoUrl: hasPhoto ? `/photos/${row.photo}?v=${encodeURIComponent(row.updated_at)}` : undefined,
    photoType: row.photo_type || undefined,
    photoW: row.photo_w ?? undefined,
    photoH: row.photo_h ?? undefined,
    photoBytes: row.photo_bytes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/* ---------- 打卡点 ---------- */

export function listCheckins() {
  return db
    .prepare('SELECT * FROM checkins ORDER BY seq ASC, created_at ASC')
    .all()
    .map(rowToCheckin)
}

export function getCheckin(id) {
  return rowToCheckin(db.prepare('SELECT * FROM checkins WHERE id = ?').get(id))
}

export function countCheckins() {
  return db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n
}

/** 新建。序号在事务里取 MAX+1，避免并发插入拿到同一个号。 */
export function createCheckin(input) {
  const id = String(input.id || newId())
  const now = new Date().toISOString()

  db.exec('BEGIN IMMEDIATE')
  try {
    const exists = db.prepare('SELECT 1 FROM checkins WHERE id = ?').get(id)
    if (exists) {
      db.exec('ROLLBACK')
      const err = new Error(`打卡点已存在: ${id}`)
      err.status = 409
      throw err
    }
    const next = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM checkins').get().n
    db.prepare(`
      INSERT INTO checkins
        (id, seq, name, note, rating, kind, lng, lat, done, from_poi, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      Number.isFinite(input.seq) ? input.seq : next,
      input.name ?? '',
      input.note ?? '',
      input.rating ?? 0,
      input.kind ?? '其他',
      input.lng,
      input.lat,
      input.done ? 1 : 0,
      input.fromPoi ?? null,
      input.createdAt || now,
      now,
    )
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 已回滚 */ }
    throw e
  }
  return getCheckin(id)
}

export function updateCheckin(id, patch) {
  const current = db.prepare('SELECT * FROM checkins WHERE id = ?').get(id)
  if (!current) return null

  const merged = {
    name: patch.name ?? current.name,
    note: patch.note ?? current.note,
    rating: patch.rating ?? current.rating,
    kind: patch.kind ?? current.kind,
    lng: patch.lng ?? current.lng,
    lat: patch.lat ?? current.lat,
    done: patch.done === undefined ? current.done : (patch.done ? 1 : 0),
    photo: patch.photo === undefined ? current.photo : patch.photo,
    photo_type: patch.photoType === undefined ? current.photo_type : patch.photoType,
    photo_w: patch.photoW === undefined ? current.photo_w : patch.photoW,
    photo_h: patch.photoH === undefined ? current.photo_h : patch.photoH,
    photo_bytes: patch.photoBytes === undefined ? current.photo_bytes : patch.photoBytes,
  }

  db.prepare(`
    UPDATE checkins SET
      name = ?, note = ?, rating = ?, kind = ?, lng = ?, lat = ?, done = ?,
      photo = ?, photo_type = ?, photo_w = ?, photo_h = ?, photo_bytes = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    merged.name, merged.note, merged.rating, merged.kind, merged.lng, merged.lat, merged.done,
    merged.photo, merged.photo_type, merged.photo_w, merged.photo_h, merged.photo_bytes,
    new Date().toISOString(), id,
  )
  return getCheckin(id)
}

/** 删除，同时清掉磁盘上的照片文件 */
export function deleteCheckin(id) {
  const row = db.prepare('SELECT photo FROM checkins WHERE id = ?').get(id)
  if (!row) return false
  db.prepare('DELETE FROM checkins WHERE id = ?').run(id)
  if (row.photo) removePhotoFile(row.photo)
  return true
}

export function clearAllCheckins() {
  // 注意返回的是「被清掉的打卡点数」，不是照片数 ——
  // 之前返回 rows.length（有照片的行数），管理后台会显示成"已清空 1 个打卡点"而实际删了 2 个。
  const total = db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n
  const photos = db.prepare('SELECT photo FROM checkins WHERE photo IS NOT NULL').all()
  db.prepare('DELETE FROM checkins').run()
  photos.forEach((r) => removePhotoFile(r.photo))
  return total
}

/* ---------- 照片文件 ---------- */

export function removePhotoFile(filename) {
  if (!filename || filename.includes('/') || filename.includes('..')) return
  try { fs.unlinkSync(path.join(UPLOAD_DIR, filename)) } catch { /* 文件可能已不存在 */ }
}

/* ---------- 设置项 ---------- */

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}