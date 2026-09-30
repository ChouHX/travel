export interface Category {
  key: string
  label: string
  color: string
}

export interface Poi {
  id: string
  name: string
  cat: string
  catLabel: string
  land: string
  lng: number | null
  lat: number | null
  coordValid: boolean
  img: string
  /** 地图标记专用的 64×64 小图，由 tools/build_markers.py 生成 */
  marker?: string
  url: string
  tags: string[]
}

/**
 * 打卡点。字段与服务端返回保持一致。
 *
 * 照片从「本地 IndexedDB 的 photoId」改成了「服务端的 photoUrl」：
 * 这样照片和点位一样是共享的，别人也能看到实拍图。
 */
export interface Checkin {
  id: string
  seq: number
  name: string
  note: string
  rating: number
  kind: string
  lng: number
  lat: number
  done: boolean
  fromPoi?: string
  /** 服务端照片地址，形如 /photos/{id}.webp?v=… */
  photoUrl?: string
  photoType?: string
  photoW?: number
  photoH?: number
  photoBytes?: number
  createdAt: string
  updatedAt?: string
}

/** 正在编辑的打卡点：id 为空表示新建 */
export interface Editing {
  id: string | null
  lng: number
  lat: number
}

export interface ExportPayload {
  format: 'ubr-checkin'
  version: number
  exportedAt: string
  crs: string
  center: { lng: number; lat: number }
  bounds: { sw: [number, number]; ne: [number, number] }
  count: number
  points: Checkin[]
}