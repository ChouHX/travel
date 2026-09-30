import type { LatLngBoundsExpression } from 'leaflet'
import type { Category } from './types'

/** 园区中心（官网配置值） */
export const CENTER: [number, number] = [39.854529, 116.681491]

/** 官网配置的完整边界 */
export const BOUNDS: LatLngBoundsExpression = [
  [39.840337, 116.668117],
  [39.868721, 116.694866],
]

/**
 * 瓦片服务的真实覆盖范围（由已抓取瓦片反推）。
 * 官网 bounds 东界超出实际覆盖约 130 米，用 COVER 做初始视野才不会留出空白带。
 */
export const COVER: LatLngBoundsExpression = [
  [39.83965, 116.667252],
  [39.869696, 116.693344],
]

export const MIN_ZOOM = 16
export const MAX_ZOOM = 19

/**
 * 缺失瓦片的补格颜色。
 * 园区地图底色是统一的草绿，用它填 404 区域可与地图边缘无缝衔接，不出现黑块。
 */
export const GAP_COLOR = '#95bd95'
export const GAP_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOYunfqfwAGuQLnFVgNdwAAAABJRU5ErkJggg=='

export const STORE_KEY = 'ubr_checkin_v1'

/** 本地瓦片路径模板（WebP 无损） */
export const tileUrl = (c: { z: number; x: number; y: number }) =>
  `tiles/${c.z}/${c.x}-${c.y}-${c.z}.webp`

// 分类配色：天蓝色系，靠色相（187–227°）与明度拉开区分
export const CATS: Category[] = [
  { key: 'play', label: '玩乐', color: '#1f9ef5' },
  { key: 'restaurant', label: '餐饮', color: '#22b8cf' },
  { key: 'show', label: '演出', color: '#4f86e8' },
  { key: 'store', label: '商店', color: '#0f7fc4' },
  { key: 'hotel', label: '酒店', color: '#5cc8f0' },
  { key: 'event', label: '活动', color: '#6d8cf0' },
]

/** 「我的打卡」在分类栏中的键，与官方分类并列 */
export const MY_CAT = 'mine'

export const CAT_MAP: Record<string, Category> = Object.fromEntries(
  CATS.map((c) => [c.key, c]),
)

/**
 * 打卡点类型。
 *
 * 「路线」是特殊类型：只有它会在图上显示序号（用来表达先后顺序），
 * 其余类型一律以「缩略图 + 名称」呈现。
 */
export const ROUTE_KIND = '路线'

export const KINDS = [
  '必拍机位', '建筑外观', '美食', '演出', ROUTE_KIND, '角色合影', '夜景', '其他',
]

/** 只有路线类型才显示序号。类型现在可以是多个标签，只要包含路线就算 */
export const showsSeq = (kinds: string | string[] | undefined) => {
  const list = Array.isArray(kinds) ? kinds : (kinds ? [kinds] : [])
  return list.includes(ROUTE_KIND)
}

/**
 * 自定义类型标签的配色。
 *
 * 预设类型有固定色；用户自定义的标签从这组色里按字符串哈希稳定取一个，
 * 这样同一个标签在任何设备上颜色都一致，相邻点位之间也有区分度。
 */
const CUSTOM_KIND_COLORS = [
  '#3f9e8e', '#7a6fc4', '#c48a3f', '#4f86e8', '#c05a8a',
  '#5aa05a', '#b06a4a', '#3f9aa8', '#8a6fc0', '#a07a3f',
]

export function kindColorFor(kinds: string | string[] | undefined): string {
  const list = Array.isArray(kinds) ? kinds : (kinds ? [kinds] : [])
  for (const k of list) {
    if (KIND_COLOR[k]) return KIND_COLOR[k]
  }
  const seed = list[0] ?? ''
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  return CUSTOM_KIND_COLORS[h % CUSTOM_KIND_COLORS.length]
}

/** 展示用的类型文本 */
export const kindsText = (kinds: string | string[] | undefined) => {
  const list = Array.isArray(kinds) ? kinds : (kinds ? [kinds] : [])
  return list.join(' · ')
}

export const KIND_COLOR: Record<string, string> = {
  必拍机位: '#1f9ef5',
  建筑外观: '#32a7fa',
  美食: '#22b8cf',
  演出: '#4f86e8',
  路线: '#0f7fc4',
  角色合影: '#6d8cf0',
  夜景: '#0b6ea8',
  其他: '#8a97a3',
}

/** 底图滤镜：暖调 / 夜览 / 原色 */
/** 语义色（天蓝色系），供内联样式复用，避免在各组件里散落硬编码 */
export const BRAND = '#1f9ef5'
export const OK = '#16a37b'
export const DANGER = '#c05a52'
