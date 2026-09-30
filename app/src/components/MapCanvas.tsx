import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import {
  BRAND, CAT_MAP, COVER, GAP_TILE, kindColorFor, kindsText,
  MAX_ZOOM, MIN_ZOOM, OK, showsSeq, tileUrl,
} from '../constants'
import type { Checkin, Editing, Poi } from '../types'

export interface Focus {
  kind: 'poi' | 'checkin'
  id: string
  ts: number
}

interface Props {
  pois: Poi[]
  marks: Checkin[]
  editing: Editing | null
  selectedId: string | null
  selectedPoiId: string | null
  armMode: boolean
  showLabels: boolean
  focus: Focus | null
  /** 路线点的显示序号（按路线自身从 1 编号） */
  routeSeq: Record<string, number>
  /** 打卡点标记用的缩略图：实拍照片，或回落官网小图 */
  ckThumbs: Record<string, string>
  mapRef: React.RefObject<L.Map | null>
  onPick: (lat: number, lng: number) => void
  onTapPoi: (poi: Poi) => void
  onTapMark: (id: string) => void
  onDragMark: (id: string, lat: number, lng: number) => void
  onEditingMove: (lat: number, lng: number) => void
}

/** 本地瓦片：官方 XYZ 网格，WebP 无损存档 */
class LocalTiles extends L.TileLayer {
  getTileUrl(coords: L.Coords) {
    return tileUrl(coords)
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * 点位标记：全部显示官方缩略图。
 *
 * 园区点位很密集（最近邻距离中位数 21 米，两组坐标完全重合），全景下会互相遮挡。
 * 不改"全显示缩略图"这个前提，只在低缩放时把标记尺寸收小，尽量少盖住彼此；
 * 放大后标记自然拉开，尺寸同步放大到舒适阅读。
 */
const MARKER_SIZE: Record<number, number> = { 16: 20, 17: 24, 18: 30, 19: 34 }

const markerSize = (zoom: number) => MARKER_SIZE[zoom] ?? 30

function poiIcon(poi: Poi, labeled: boolean, active: boolean, zoom: number) {
  const color = CAT_MAP[poi.cat]?.color ?? BRAND
  const pic = poi.marker
    ? `<img src="${poi.marker}" alt="" loading="lazy" onerror="this.remove()">`
    : '<span class="fb"></span>'
  const fallback = '<span class="fb"></span>'

  if (labeled) {
    return L.divIcon({
      className: `pin-ubr lbl${active ? ' act' : ''}`,
      iconAnchor: [13, 13],
      html:
        `<div class="mklbl" style="--c:${color}">` +
        `<span class="mk">${pic}${fallback}</span>` +
        `<span class="nm">${escapeHtml(poi.name)}</span></div>`,
    })
  }

  const size = markerSize(zoom)
  return L.divIcon({
    className: `pin-ubr${active ? ' act' : ''}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="mk" style="--c:${color}">${pic}${fallback}</div>`,
  })
}

/**
 * 打卡点标记。
 *
 * 「路线」类型显示序号图钉 —— 序号表达了走访顺序，是这个类型存在的意义；
 * 其余类型一律「缩略图 + 名称」，因为自定义点位真正需要的是"这是哪儿"，
 * 全局递增的序号对它们没有信息量。
 */
/**
 * 打卡点标记。两种形态：
 *
 * - 「路线」类型 → 序号图钉。序号表达走访顺序，是这个类型存在的意义。
 * - 其余类型 → 立标小卡片：缩略图 + 名称 + 类型标签。
 *
 * 卡片刻意做得比官方点位标记更醒目（更大、带类型色边框与投影、底部有指向尖角），
 * 因为自定义点位是用户自己标的，需要一眼能从官方点位里区分出来。
 * 类型标签直接显示在卡片上，不再统称「我的打卡」。
 */
const CK_CARD_W = 118
const CK_CARD_H = 48

function ckIcon(
  mark: Checkin,
  opts: { selected: boolean; fresh: boolean; seq?: number; thumb?: string },
) {
  const { selected, fresh, seq, thumb } = opts
  const kinds = mark.kinds ?? [mark.kind]
  const color = mark.done ? OK : kindColorFor(kinds)
  const name = mark.name || '未命名'

  if (showsSeq(kinds)) {
    const cls = `pin-ck pin-ck-seq${selected ? ' sel' : ''}${mark.done ? ' done' : ''}${fresh ? ' pop' : ''}`
    return L.divIcon({
      className: cls,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      html:
        '<div class="wrap"><svg viewBox="0 0 26 34">' +
        `<path class="body" d="M13 0C5.8 0 0 5.8 0 13c0 9.4 13 21 13 21s13-11.6 13-21C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#fff" stroke-width="2"/>` +
        `</svg><span class="num">${seq ?? ''}</span></div>`,
    })
  }

  const pic = thumb
    ? `<img src="${thumb}" alt="" loading="lazy" onerror="this.remove()">`
    : ''
  const cls = `pin-ck pin-ck-lbl${selected ? ' sel' : ''}${mark.done ? ' done' : ''}${fresh ? ' pop' : ''}`
  return L.divIcon({
    className: cls,
    iconSize: [CK_CARD_W, CK_CARD_H],
    iconAnchor: [CK_CARD_W / 2, CK_CARD_H],
    html:
      `<div class="cklbl" style="--c:${color}">` +
      `<span class="thumb">${pic}<span class="fb"></span></span>` +
      '<span class="txt">' +
      `<span class="nm">${escapeHtml(name)}</span>` +
      `<span class="kd">${escapeHtml(kindsText(kinds))}</span>` +
      '</span>' +
      '</div>' +
      '<span class="tip"></span>',
  })
}

export function MapCanvas(props: Props) {
  const { pois, marks, editing, selectedId, selectedPoiId, armMode, showLabels, focus, routeSeq, ckThumbs, mapRef } = props

  const hostRef = useRef<HTMLDivElement>(null)
  const poiLayer = useRef<L.LayerGroup | null>(null)
  const ckLayer = useRef<L.LayerGroup | null>(null)
  const editMarker = useRef<L.Marker | null>(null)
  const prevIds = useRef(new Set<string>())
  /** id → marker，供选中态与缩放在不重建 DOM 的前提下就地更新 */
  const poiMarkers = useRef(new Map<string, L.Marker & { _poiId?: string }>())
  const ckMarkers = useRef(new Map<string, L.Marker>())
  /** 上一次的标签模式；变化时点位图层需整层重建（图标结构不同） */
  const prevLabels = useRef<boolean | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const cb = useRef(props)
  cb.current = props

  /* ---------- 初始化（仅一次） ---------- */
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return
    const b = COVER as number[][]
    const map = L.map(hostRef.current, {
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomControl: false,
      zoomSnap: 1,
      zoomDelta: 1,
      maxBounds: [
        [b[0][0] - 0.006, b[0][1] - 0.006],
        [b[1][0] + 0.006, b[1][1] + 0.006],
      ],
      maxBoundsViscosity: 0.85,
      // 保留 Leaflet 默认的 markerZoomAnimation。
      // 试过关掉它来省掉"每个标记各写一次 transform"（126 个 = 251 次），
      // 但 Leaflet 的实现是给标记层加 .leaflet-zoom-hide，其 CSS 为
      // visibility: hidden —— 缩放动画期间标记会整体消失再出现，闪烁比省下的开销更糟。
      // 那些 transform 写入本身就是 GPU 合成的，代价可接受。
      // 关掉右下角的 Leaflet 版权条。
      // 该控件默认渲染 "Leaflet | 地图瓦片 © …" 一行，在移动端会压在右下角按钮附近。
      // 数据来源与版权说明保留在 README 的「数据来源」一节。
      attributionControl: false,
    })
    // 先定视野再挂瓦片：否则会先按默认 zoom 拉一批，切视图后立刻丢弃
    map.fitBounds(COVER, { padding: [12, 12] })

    new LocalTiles('', {
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      errorTileUrl: GAP_TILE,
      keepBuffer: 4,
      attribution: '地图瓦片 © 北京环球度假区官方 · 本地离线存档',
    }).addTo(map)

    poiLayer.current = L.layerGroup().addTo(map)
    ckLayer.current = L.layerGroup().addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => cb.current.onPick(e.latlng.lat, e.latlng.lng))
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      if (!cb.current.armMode) cb.current.onPick(e.latlng.lat, e.latlng.lng)
    })

    setZoom(map.getZoom())
    map.on('zoomend', () => setZoom(map.getZoom()))

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      poiLayer.current = null
      ckLayer.current = null
      editMarker.current = null
    }
  }, [mapRef])


  useEffect(() => {
    hostRef.current?.classList.toggle('arming', armMode)
  }, [armMode])

  /* ---------- 官方点位（增量增删，避免整层重建） ---------- */
  // 早期每次 pois 变化都 clearLayers + 全量重建。切换分类显隐只影响其中一类，
  // 却要重建全部 126 个标记 —— CPU 降速 6× 下实测单次 224ms 长任务，明显卡顿。
  // 现在做增量 diff：只移除消失的点、只创建新增的点，其余 marker 原地保留。
  // 标签模式会改变所有图标结构，那种情况才整层重建（用户主动切换，频率低）。
  useEffect(() => {
    const layer = poiLayer.current
    if (!layer) return

    const wanted = new Map<string, Poi>()
    pois.forEach((poi) => {
      if (poi.coordValid === false || poi.lat == null || poi.lng == null) return
      wanted.set(poi.id, poi)
    })

    // 标签模式切换会让每个图标的内部结构都变，必须重建
    if (prevLabels.current !== showLabels) {
      prevLabels.current = showLabels
      layer.clearLayers()
      poiMarkers.current.clear()
    } else {
      // 移除已不需要的
      poiMarkers.current.forEach((marker, id) => {
        if (!wanted.has(id)) {
          layer.removeLayer(marker)
          poiMarkers.current.delete(id)
        }
      })
    }

    // 新增缺失的（已存在的原地保留，DOM 不重建）
    wanted.forEach((poi, id) => {
      if (poiMarkers.current.has(id)) return
      const marker = L.marker([poi.lat as number, poi.lng as number], {
        icon: poiIcon(poi, showLabels, poi.id === cb.current.selectedPoiId, zoom),
        riseOnHover: true,
        zIndexOffset: 100,
      }) as L.Marker & { _poiId?: string }
      marker._poiId = poi.id
      marker.on('click', (e) => {
        if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent)
        cb.current.onTapPoi(poi)
      })
      marker.addTo(layer)
      poiMarkers.current.set(poi.id, marker)
    })
    // zoom 只用于新建标记时的初始尺寸，变化时由下面的 CSS 变量 effect 统一处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, showLabels])

  /* ---------- 选中态：切换 class，不重建标记 ---------- */
  useEffect(() => {
    poiMarkers.current.forEach((marker, id) => {
      marker.getElement()?.classList.toggle('act', id === selectedPoiId)
    })
  }, [selectedPoiId, pois, showLabels])

  /* ---------- 缩放：只在图层根节点写一次 CSS 变量 ---------- */
  // 早期写法是遍历 126 个标记、每个写 5 条内联样式（--s / width / height / marginLeft / marginTop），
  // 一次缩放就是 600+ 次 style 写入，每次都可能触发样式重算 —— 这是缩放卡顿的主因。
  // 现在把尺寸抽成 CSS 变量挂在图层容器上（xy 各一次，共 2 次写入），
  // 标记尺寸/定位/内边距全部由 CSS 通过 var() 计算，浏览器只需重算一次。
  useEffect(() => {
    const size = markerSize(zoom)
    const host = mapRef.current?.getContainer()
    if (!host) return
    host.style.setProperty('--ubr-mk', `${size}px`)
    host.style.setProperty('--ubr-mk-half', `${-size / 2}px`)
  }, [zoom, mapRef])

  /* ---------- 打卡点 ---------- */
  useEffect(() => {
    const layer = ckLayer.current
    if (!layer) return
    layer.clearLayers()
    ckMarkers.current.clear()   // 与 DOM 同步：否则已删除的点位会残留在索引里
    marks.forEach((mark) => {
      const isNew = !prevIds.current.has(mark.id)
      const marker = L.marker([mark.lat, mark.lng], {
        icon: ckIcon(mark, {
          selected: false,                 // 选中态由下面的 effect 就地切换
          fresh: isNew,
          seq: routeSeq[mark.id],
          thumb: ckThumbs[mark.id],
        }),
        draggable: true,
        zIndexOffset: 600,
        riseOnHover: true,
        autoPan: false,
      })
      marker.on('click', (e) => {
        if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent)
        cb.current.onTapMark(mark.id)
      })
      marker.on('dragend', () => {
        const ll = marker.getLatLng()
        cb.current.onDragMark(mark.id, +ll.lat.toFixed(7), +ll.lng.toFixed(7))
      })
      marker.addTo(layer)
      ckMarkers.current.set(mark.id, marker)
    })
    prevIds.current = new Set(marks.map((m) => m.id))
    // routeSeq / ckThumbs 都基于 marks 派生，随 marks 一起变化，这里显式列出便于阅读
  }, [marks, routeSeq, ckThumbs])

  /* ---------- 打卡点选中态：就地切换 class ---------- */
  useEffect(() => {
    ckMarkers.current.forEach((marker, id) => {
      marker.getElement()?.classList.toggle('sel', id === selectedId)
    })
  }, [selectedId, marks])

  /* ---------- 编辑中的临时标记 ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    editMarker.current?.remove()
    editMarker.current = null
    if (!editing) return
    const marker = L.marker([editing.lat, editing.lng], {
      draggable: true,
      zIndexOffset: 900,
      icon: L.divIcon({
        className: 'pin-edit',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html: '<div class="ring"></div><div class="dot"></div>',
      }),
    }).addTo(map)
    marker.on('dragend', () => {
      const ll = marker.getLatLng()
      cb.current.onEditingMove(+ll.lat.toFixed(7), +ll.lng.toFixed(7))
    })
    editMarker.current = marker
  }, [editing, mapRef])

  /* ---------- 外部定位 ---------- */
  // 只依赖 focus。若把 marks / pois 也放进来，切换完成状态、增删打卡点都会
  // 重新触发一次 setView —— 地图会无谓地"跳"一下并多跑一次动画。
  // 数据通过 ref 读取最新值即可。
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    const list = focus.kind === 'checkin' ? cb.current.marks : cb.current.pois
    const target = list.find((x) => x.id === focus.id)
    if (!target || target.lat == null || target.lng == null) return
    map.setView([target.lat, target.lng], Math.max(map.getZoom(), 18), { animate: true })
  }, [focus, mapRef])

  return <div id="map" ref={hostRef} />
}
