import { ROUTE_KIND } from '../constants'
import type { Checkin } from '../types'

/**
 * 路线点的显示序号。
 *
 * 存储用的 seq 是全局递增的（所有打卡点共用一套），直接显示会出现
 * "只有一个路线点却显示 7"这种怪现象。这里按路线点自身重新从 1 编号。
 */
export function routeIndexMap(marks: Checkin[]): Record<string, number> {
  const routes = marks
    .filter((m) => (m.kinds ?? [m.kind]).includes(ROUTE_KIND))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const out: Record<string, number> = {}
  routes.forEach((m, i) => { out[m.id] = i + 1 })
  return out
}

/**
 * 打卡点在地图上用的缩略图。
 *
 * 优先实拍照片；由官网点位转来的打卡点还没传照片时，回落到官方 64×64 小图
 * （那个很轻，127 张总共 189KB）。
 */
export function buildThumbs(
  marks: Checkin[],
  poiMarker: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of marks) {
    const url = m.photoUrl || (m.fromPoi ? poiMarker[m.fromPoi] : undefined)
    if (url) out[m.id] = url
  }
  return out
}

/** 类型开关与官方分类使用独立的键，避免同名冲突。 */
export const kindVisibilityKey = (kind: string) => `checkin:${kind}`
export const checkinKinds = (mark: Checkin) =>
  [...new Set(mark.kinds?.length ? mark.kinds : [mark.kind || '其他'])]

export function checkinTypeCounts(marks: Checkin[]) {
  const counts = new Map<string, number>()
  for (const mark of marks) {
    for (const kind of checkinKinds(mark)) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return Array.from(counts, ([kind, count]) => ({ kind, count }))
}
