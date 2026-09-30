import type { Map as LeafletMap } from 'leaflet'

/**
 * 把目标点平移到「未被详情卡片遮挡的可视区」中心。
 *
 * 底部抽屉会盖住屏幕下方一大块，直接 setView 到点位会让它正好被卡片压住，
 * 用户看不到自己点的是哪儿。这里先在像素空间把投影点下移遮挡高度的一半，
 * 再反投影成新中心——效果是目标点落在可视区垂直中心，而不是整屏中心。
 *
 * @param coveredRatio 屏幕被卡片遮住的比例（0–1），底部抽屉约 0.5
 */
export function panIntoVisibleArea(
  map: LeafletMap,
  lat: number,
  lng: number,
  coveredRatio = 0.5,
  options: { zoom?: number; animate?: boolean } = {},
) {
  const zoom = options.zoom ?? map.getZoom()
  const size = map.getSize()

  // 目标点在当前缩放下的像素坐标
  const point = map.project([lat, lng], zoom)
  // 可视区是上方 (1 - coveredRatio)，其中心相对整屏中心上移 coveredRatio/2
  point.y += (size.y * coveredRatio) / 2

  map.setView(map.unproject(point, zoom), zoom, {
    animate: options.animate ?? true,
    duration: 0.45,
  })
}

/** 屏幕被底部抽屉遮住的比例；桌面端右侧面板不遮挡垂直方向，返回 0 */
export function coveredRatioFor(viewportWidth: number, sheetHeightPx: number) {
  if (viewportWidth > 860) return 0
  const vh = window.innerHeight || 1
  return Math.min(0.75, Math.max(0, sheetHeightPx / vh))
}
