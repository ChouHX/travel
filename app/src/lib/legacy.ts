/**
 * 旧版本地数据读取与迁移。
 *
 * 旧实现把打卡点放在 localStorage、照片放在 IndexedDB，只有本机浏览器能看到。
 * 这里把它们读出来并上传到服务端，让已有的标注不至于丢失。
 * 迁移是幂等的：服务端按 id 去重，重复执行只会跳过已存在的点位。
 */
import { api } from './api'
import { getPhoto, clearPhotos } from './idb'

const STORE_KEY = 'ubr_checkin_v1'

export interface LegacyPoint {
  id: string
  seq?: number
  name: string
  note: string
  rating: number
  kind: string
  lng: number
  lat: number
  done: boolean
  fromPoi?: string
  createdAt?: string
  photoBlob?: Blob
  photoType?: string
  photoW?: number
  photoH?: number
}

export interface LegacyBundle {
  points: LegacyPoint[]
  photoCount: number
}

function asNumber(v: unknown, dflt = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

/** 读取本机旧数据；没有就返回空 */
export async function readLegacyLocalData(): Promise<LegacyBundle> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORE_KEY)
  } catch {
    return { points: [], photoCount: 0 }
  }
  if (!raw) return { points: [], photoCount: 0 }

  let list: unknown[] = []
  try {
    const parsed = JSON.parse(raw)
    list = Array.isArray(parsed) ? parsed : ((parsed as { points?: unknown[] })?.points ?? [])
  } catch {
    return { points: [], photoCount: 0 }
  }

  const points: LegacyPoint[] = []
  let photoCount = 0

  for (const item of list) {
    const p = item as Record<string, unknown>
    const lng = asNumber(p.lng, NaN)
    const lat = asNumber(p.lat, NaN)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue

    const point: LegacyPoint = {
      id: String(p.id ?? ''),
      seq: Number.isFinite(Number(p.seq)) ? Number(p.seq) : undefined,
      name: String(p.name ?? ''),
      note: String(p.note ?? ''),
      rating: asNumber(p.rating, 0),
      kind: String(p.kind ?? '其他'),
      lng,
      lat,
      done: !!p.done,
      fromPoi: p.fromPoi ? String(p.fromPoi) : undefined,
      createdAt: p.createdAt ? String(p.createdAt) : undefined,
    }

    // 旧版的照片键是 photo-{点位 id}
    const photoId = p.photoId ? String(p.photoId) : ''
    if (photoId) {
      try {
        const blob = await getPhoto(photoId)
        if (blob) {
          point.photoBlob = blob
          point.photoType = p.photoType ? String(p.photoType) : blob.type
          point.photoW = p.photoW ? asNumber(p.photoW) : undefined
          point.photoH = p.photoH ? asNumber(p.photoH) : undefined
          photoCount += 1
        }
      } catch {
        /* 单张读取失败不影响其余点位 */
      }
    }
    points.push(point)
  }

  return { points, photoCount }
}

export interface MigrateResult {
  added: number
  skipped: number
  photos: number
  failed: string[]
  /** 本机原有数据总量，便于界面提示"发现 N 条" */
  found: number
}

/** 把本机旧数据上传到服务端 */
export async function migrateLegacyToServer(
  onProgress?: (done: number, total: number) => void,
): Promise<MigrateResult> {
  const { points } = await readLegacyLocalData()
  const result: MigrateResult = { added: 0, skipped: 0, photos: 0, failed: [], found: points.length }
  if (!points.length) return result

  let done = 0
  for (const p of points) {
    try {
      // 带上原 id，服务端据此去重：重复点"上传"不会产生副本
      const created = await api.createCheckin({
        id: p.id || undefined,
        name: p.name,
        note: p.note,
        rating: p.rating,
        kind: p.kind,
        lng: p.lng,
        lat: p.lat,
        done: p.done,
        fromPoi: p.fromPoi,
        createdAt: p.createdAt,
      } as never)

      if (p.photoBlob) {
        await api.uploadPhoto(created.id, p.photoBlob, p.photoW ?? 0, p.photoH ?? 0)
        result.photos += 1
      }
      result.added += 1
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上传失败'
      // 已存在属于正常情况（重复迁移），单独计数
      if (msg.includes('已存在')) result.skipped += 1
      else result.failed.push(`${p.name || p.id}: ${msg}`)
    }
    done += 1
    onProgress?.(done, points.length)
  }

  return result
}

/** 迁移成功后清掉本机旧数据，避免下次又提示"发现本地数据" */
export async function clearLegacyLocalData(): Promise<void> {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch { /* 忽略 */ }
  try {
    await clearPhotos()
  } catch { /* 忽略 */ }
}