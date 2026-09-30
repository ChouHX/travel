import { useCallback, useMemo, useRef, useState } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { Center, Drawer, ActionIcon, Button, Group, Loader, Text, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import poisData from './data/pois.json'
import { CATS, MY_CAT } from './constants'
import { buildThumbs, routeIndexMap, checkinKinds, checkinTypeCounts, kindVisibilityKey } from './lib/checkins'
import type { Editing, Poi } from './types'
import { useCheckins } from './hooks/useCheckins'
import { useAdmin } from './hooks/useAdmin'
import { useRoute } from './hooks/useRoute'
import { ApiError, api, downloadJson } from './lib/api'
import { panIntoVisibleArea } from './lib/map'
import { MapCanvas, type Focus } from './components/MapCanvas'
import { MapToolbar } from './components/MapToolbar'
import { SpotSheet } from './components/SpotSheet'
import { SpotList } from './components/SpotList'
import { CategoryTabs } from './components/CategoryTabs'
import { SpotEditor, type EditorResult } from './components/SpotEditor'
import { SheetGrabber } from './components/SheetGrabber'
import { AdminGate } from './components/AdminGate'
import { AdminPanel } from './components/AdminPanel'
import { PhotoViewer } from './components/PhotoViewer'

const POIS = poisData as unknown as Poi[]
const POIS_OK = POIS.filter((p) => p.coordValid !== false)
const OFFICIAL_CATS = CATS.map((c) => c.key)

const icon = (path: string, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
)

interface Toast {
  text: string
  kind: 'ok' | 'warn'
}

export function App() {
  const [route, navigate] = useRoute()
  const admin = useAdmin()
  const ck = useCheckins()
  const mobile = useMediaQuery('(max-width: 860px)') ?? true

  /** 列表浏览的分类（单选 tab） */
  const [tab, setTab] = useState<string>('all')
  /** 地图上被隐藏的系列；与 tab 无关，由工具栏的显示管理 Popover 控制 */
  const [hidden, setHidden] = useState<string[]>([])

  const [query, setQuery] = useState('')
  const [showLabels, setShowLabels] = useState(false)
  const [selected, setSelected] = useState<{ kind: 'poi' | 'checkin'; id: string } | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [armMode, setArmMode] = useState(false)
  /**
   * 抽屉「是否打开」与「里面显示什么」是两个独立状态。
   *
   * 之前用 listOpen/selected/editing 三者直接推导打开状态，关闭时三态同时清空，
   * 内容分支就回落到最后的 else（列表）——于是退场动画整个 280ms 都在滑一块列表，
   * 表现为"详情消失前先弹一下列表"。现在 open 单独控制可见性，
   * 内容状态保留到 onExited 再清，动画期间画面保持为详情。
   */
  const [open, setOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  /**
   * 大图查看。状态放在 App 而不是详情组件里 —— 打开时要临时关掉抽屉的 ESC 响应，
   * 这需要在上层协调（原因见 PhotoViewer 的注释）。
   */
  const [viewer, setViewer] = useState<{ src: string; title: string; note?: string } | null>(null)

  const mapRef = useRef<LeafletMap | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    setToast({ text, kind })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  /**
   * 统一包裹写操作。服务端校验通过才生效，所以必须处理两类失败：
   *  - 401：会话过期（例如被别的设备改口令踢掉）→ 回到未登录态
   *  - 其它：网络错误或服务端校验失败 → 原样提示后端文案
   */
  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          admin.markExpired()
          notify('登录已过期，请重新登录', 'warn')
        } else {
          notify(e instanceof Error ? e.message : '操作失败', 'warn')
        }
      }
    },
    [admin, notify],
  )

  /** 关闭抽屉：只置 open=false，内容留到 onExited 再清，避免动画途中回落到列表 */
  const closeDrawer = useCallback(() => setOpen(false), [])
  /** 退场动画结束后再清空内容状态 */
  const clearContent = useCallback(() => {
    setListOpen(false)
    setSelected(null)
    setEditing(null)
    setViewer(null)
  }, [])

  /* ---------- 派生 ---------- */
  const q = query.trim().toLowerCase()
  const visibleCats = useMemo(() => OFFICIAL_CATS.filter((k) => !hidden.includes(k)), [hidden])

  /** 列表内容：跟着 tab 走（浏览范围） */
  const listedPois = useMemo(
    () =>
      POIS.filter((p) => {
        if (tab !== 'all' && tab !== MY_CAT && p.cat !== tab) return false
        if (!q) return true
        return (
          p.name.toLowerCase().includes(q) ||
          (p.land || '').toLowerCase().includes(q) ||
          (p.tags || []).join(' ').toLowerCase().includes(q)
        )
      }),
    [tab, q],
  )

  const listedMarks = useMemo(() => {
    if (tab !== 'all' && tab !== MY_CAT) return []
    if (!q) return ck.marks
    return ck.marks.filter(
      (m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.note || '').toLowerCase().includes(q) ||
        (m.kinds ?? [m.kind]).join(' ').toLowerCase().includes(q),
    )
  }, [ck.marks, q, tab])

  /** 地图内容：跟着「显示管理」的 hidden 走，与 tab 解耦 */
  const mapPois = useMemo(
    () =>
      POIS.filter(
        (p) => p.coordValid !== false && visibleCats.includes(p.cat),
      ),
    [visibleCats],
  )
  const mapMarks = useMemo(
    () => ck.marks.filter((mark) => checkinKinds(mark).some((kind) => !hidden.includes(kindVisibilityKey(kind)))),
    [ck.marks, hidden],
  )

  const markTypes = useMemo(() => checkinTypeCounts(ck.marks), [ck.marks])

  /** 路线点的显示序号：按路线自身从 1 编号，不受其它类型影响 */
  const routeSeq = useMemo(() => routeIndexMap(ck.marks), [ck.marks])
  /** 打卡点标记用的缩略图：实拍照片，或回落官网 64×64 小图 */
  const ckThumbs = useMemo(() => {
    const poiMarker: Record<string, string> = {}
    POIS.forEach((p) => { if (p.marker) poiMarker[p.id] = p.marker })
    return buildThumbs(ck.marks, poiMarker)
  }, [ck.marks])

  const poiCounts = useMemo(() => {
    const o: Record<string, number> = {}
    CATS.forEach((c) => (o[c.key] = POIS_OK.filter((p) => p.cat === c.key).length))
    return o
  }, [])

  const activePoi = selected?.kind === 'poi' ? (POIS.find((p) => p.id === selected.id) ?? null) : null
  const activeMark = selected?.kind === 'checkin' ? (ck.marks.find((m) => m.id === selected.id) ?? null) : null
  const selectedKey = selected ? `${selected.kind === 'poi' ? 'poi' : 'ck'}:${selected.id}` : null

  /* ---------- 交互 ---------- */
  /** 详情会压住屏幕下方，把点位平移到未遮挡区域 */
  const panToSpot = useCallback((lat: number, lng: number) => {
    const map = mapRef.current
    if (!map) return
    if (window.innerWidth > 860) return // 桌面端面板在右侧，不占垂直空间
    requestAnimationFrame(() => {
      const el = document.querySelector('.mantine-Drawer-content') as HTMLElement | null
      const h = el?.getBoundingClientRect().height ?? 0
      const covered = Math.min(0.6, h / (window.innerHeight || 1))
      panIntoVisibleArea(map, lat, lng, covered)
    })
  }, [])

  const openPoi = useCallback((poi: Poi) => {
    setViewer(null)
    setEditing(null)
    setListOpen(false)   // 从列表点进详情时收起列表，不做层叠导航
    setSelected({ kind: 'poi', id: poi.id })
    setOpen(true)
    setFocus({ kind: 'poi', id: poi.id, ts: Date.now() })
    if (poi.lat != null && poi.lng != null) panToSpot(poi.lat, poi.lng)
  }, [panToSpot])

  const openMark = useCallback(
    (id: string) => {
      setViewer(null)
      setEditing(null)
      setListOpen(false)   // 同上：详情与列表是同一层，不叠加
      setSelected({ kind: 'checkin', id })
      setOpen(true)
      setFocus({ kind: 'checkin', id, ts: Date.now() })
      const m = ck.marks.find((x) => x.id === id)
      if (m) panToSpot(m.lat, m.lng)
    },
    [ck.marks, panToSpot],
  )

  const handlePick = useCallback(
    (lat: number, lng: number) => {
      if (!admin.authed) return
      if (!armMode) {
        closeDrawer()
        return
      }
      setSelected(null)
      setEditing({ id: null, lng: +lng.toFixed(7), lat: +lat.toFixed(7) })
      setArmMode(false)
      setOpen(true)
    },
    [admin.authed, armMode],
  )

  const handleSave = useCallback(
    async (data: EditorResult) => {
      if (!editing) return
      const isNew = !editing.id
      await guard(async () => {
        // 先落库拿到 id，再传照片（照片接口需要点位 id）
        const id = editing.id
          ? (await ck.update(editing.id, {
              name: data.name, note: data.note, rating: data.rating, kinds: data.kinds,
            })).id
          : (await ck.create({
              name: data.name, note: data.note, rating: data.rating, kinds: data.kinds,
              lng: editing.lng, lat: editing.lat,
            })).id

        if (data.photo) {
          await ck.savePhoto(id, data.photo.blob, {
            w: data.photo.width,
            h: data.photo.height,
          })
        } else if (data.photoCleared && editing.id) {
          await ck.removePhoto(id)
        }

        setSelected({ kind: 'checkin', id })
        setEditing(null)
        setOpen(true)
        notify(isNew ? '已添加打卡点' : '已更新打卡点')
      })
    },
    [ck, editing, guard, notify],
  )

  const handleAddFromPoi = useCallback(
    (poi: Poi) => {
      if (!admin.authed) return
      if (poi.coordValid === false || poi.lng == null || poi.lat == null) {
        notify('该点位官网坐标缺失，请手动落点', 'warn')
        return
      }
      void guard(async () => {
        const rec = await ck.create({
          name: poi.name,
          kind: '必拍机位',
          rating: 0,
          note: poi.land ? `所属园区：${poi.land}` : '',
          lng: poi.lng as number,
          lat: poi.lat as number,
          fromPoi: poi.id,
        })
        setSelected({ kind: 'checkin', id: rec.id })
        setOpen(true)
        setHidden((prev) => prev.filter((k) => !checkinKinds(rec).some((kind) => k === kindVisibilityKey(kind))))
        setFocus({ kind: 'checkin', id: rec.id, ts: Date.now() })
        notify(`已加入打卡清单：${poi.name}`)
      })
    },
    [admin.authed, ck, guard, notify],
  )

  /** 删除打卡点。确认由调用处的 ConfirmPopover 负责，这里直接执行。 */
  const handleRemove = useCallback(
    (id: string) => {
      const name = ck.marks.find((x) => x.id === id)?.name
      void guard(async () => {
        await ck.remove(id)
        closeDrawer()
        notify(`已删除：${name || '未命名打卡点'}`)
      })
    },
    [ck, closeDrawer, guard, notify],
  )

  const handleFit = useCallback(() => {
    mapRef.current?.fitBounds(
      [
        [39.83965, 116.667252],
        [39.869696, 116.693344],
      ],
      { padding: [20, 20] },
    )
  }, [])

  /* ---------- 管理员页 ---------- */
  if (route === 'admin') {
    if (!admin.ready) {
      return (
        <Center mih="100dvh">
          <Loader size="sm" />
        </Center>
      )
    }
    if (!admin.authed) {
      return <AdminGate onLogin={admin.login} onBack={() => navigate('map')} usingDefault={admin.usingDefault} />
    }
    return (
      <AdminPanel
        marks={ck.marks}
        usingDefault={admin.usingDefault}
        onBack={() => navigate('map')}
        notify={notify}
        onRefresh={() => ck.refresh(true)}
        onExport={async (withPhotos) => {
          const payload = await api.buildExportFile(withPhotos)
          downloadJson(payload, `环球影城打卡点_${new Date().toISOString().slice(0, 10)}.json`)
          notify(`已导出 ${ck.marks.length} 个打卡点`)
        }}
        onImport={async (file) => {
          if (!file) return
          try {
            const data = JSON.parse(await file.text())
            const points = Array.isArray(data) ? data : (data?.points ?? [])
            if (!points.length) { notify('文件里没有打卡点', 'warn'); return }
            const { added, skipped } = await ck.importPoints(points)
            notify(`导入 ${added} 个打卡点${skipped.length ? `，跳过 ${skipped.length} 个已存在` : ''}`)
          } catch {
            notify('解析失败：不是有效的标注 JSON', 'warn')
          }
        }}
        onChangePassword={admin.changePassword}
        onLogout={() => { void admin.logout(); navigate('map') }}
        onClearMarks={async () => {
          const removed = await ck.clearAll()
          closeDrawer()
          notify(`已清空 ${removed} 个打卡点`)
        }}
      />
    )
  }

  /* ---------- 地图页 ---------- */
  // 主抽屉：列表 / 详情 / 编辑三态共用，避免多层抽屉叠加
  const mainOpen = open

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapCanvas
        pois={mapPois}
        marks={mapMarks}
        editing={editing}
        selectedId={activeMark?.id ?? null}
        selectedPoiId={activePoi?.id ?? null}
        armMode={armMode}
        showLabels={showLabels}
        focus={focus}
        routeSeq={routeSeq}
        ckThumbs={ckThumbs}
        mapRef={mapRef}
        onPick={handlePick}
        onTapPoi={openPoi}
        onTapMark={openMark}
        onDragMark={(id, lat, lng) => {
          void guard(async () => {
            await ck.update(id, { lat, lng })
            notify('已更新坐标')
          })
        }}
        onEditingMove={(lat, lng) => setEditing((p) => (p ? { ...p, lat, lng } : p))}
      />

      <MapToolbar
        isAdmin={admin.authed}
        armMode={armMode}
        showLabels={showLabels}
        onToggleArm={() => {
          const next = !armMode
          setArmMode(next)
          // 进入落点模式要收起抽屉：否则透明遮罩会吃掉地图点击，根本没法落点
          if (next) closeDrawer()
        }}
        onToggleLabels={() => setShowLabels((v) => !v)}
        onFit={handleFit}
        hidden={hidden}
        onToggleHidden={(k) =>
          setHidden((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
        }
        onSetAllHidden={(allHidden) => setHidden(allHidden ? [...OFFICIAL_CATS, ...markTypes.map(({ kind }) => kindVisibilityKey(kind))] : [])}
        poiCounts={poiCounts}
        markTypes={markTypes}
        mobile={mobile}
      />


      {/* 右下角浮动按钮组：抽屉关闭时常驻 */}
      <div className={`ubr-fab-stack${mainOpen ? ' hidden' : ''}`}>
        <Button
          color="sky"
          size="md"
          radius="xl"
          leftSection={icon('M4 7h16M4 12h10M4 17h7')}
          onClick={() => {
            setListOpen(true)
            setOpen(true)
          }}
          style={{ boxShadow: 'var(--ubr-shadow-lg)' }}
        >
          点位列表
        </Button>
      </div>

      {/* 主抽屉：列表 / 详情 / 编辑 */}
      <Drawer
        opened={mainOpen}
        // 一次性收起：不做"先退一层"的层叠导航
        onClose={closeDrawer}
        // 大图打开时让出 ESC：Mantine 的 ESC 监听在 window 的 capture 阶段，
        // 两层同时监听时同一个 ESC 会触发两边 onClose，表现为"看大图按 ESC 详情也没了"。
        closeOnEscape={!viewer}
        // 两端统一用底部抽屉：桌面端此前是右侧 380px 全高面板，
        // 与移动端的展开方式、关闭手势、尺寸规律都不一致，维护与体验都要各写一套。
        position="bottom"
        size={undefined}
        // 圆角自己控制：底部抽屉贴屏幕下沿，下面两个角必须是方的。
        // Mantine 的 radius 会给四个角统一加圆角（lg=16px），所以置 0，
        // 再在 content 上用内联 borderRadius 只圆上沿。
        radius={0}
        // 全部状态都不要 header。
        // Mantine 的条件是 `hasHeader = !!title || withCloseButton`，两者任一为真
        // 就会渲染一条 60px 的头部（只有标题/关闭按钮），在内容上方形成白边。
        // 关闭方式已经有两条：点击空白（overlay）、ESC。详情与编辑各有自己的内嵌
        // 关闭/取消入口，因此头部纯属冗余，去掉后把高度让给内容。
        withCloseButton={false}
        // 去掉遮罩。
        // Mantine 的「点击外部关闭」挂在 overlay 上，所以去掉它就没有"点空白关闭"；
        // 但 overlay 是一层 pointer-events:auto 的全屏元素（哪怕背景全透明），
        // 留着它抽屉开着时就点不到地图上的其他点位。这里取 iOS 的做法：
        // 不要遮罩，改由顶部的抓取条下拉关闭，地图始终可交互。
        withOverlay={false}
        transitionProps={{ duration: 280, onExited: clearContent }}
        styles={{
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // 必须同时给 flex 与 min-height。
            // Mantine 的 Drawer body 默认是 flex: 0 1 auto，不撑满 content 高度：
            // 子元素会把 body 顶到内容全高（实测 8390px），最终滚动落到 Drawer content 上，
            // 搜索框和分类标签就会跟着列表一起滚走。
            flex: '1 1 auto',
            minHeight: 0,
            paddingTop: 'env(safe-area-inset-top, 0px)',
          },
          // 移动端要同时给 width / flex / height：
          //  .mantine-Drawer-inner 是 flex 行容器，只写 flex 会被当成「宽度」basis
          //  （74% → 289px 而不是满宽）；只写 flex 不写 height 又会回退到默认 md(440px)。
          // 尺寸规则两端一致（此前桌面端另有一套右栏样式）
          content:
            editing || selected
              ? {
                  flex: '0 0 auto',
                  width: '100%',
                  maxWidth: '100%',
                  height: 'auto',
                  maxHeight: '70vh',
                  borderRadius: '16px 16px 0 0', // 只圆上沿，下沿贴屏
                }
              : {
                  flex: '0 0 auto',
                  width: '100%',
                  maxWidth: '100%',
                  height: '74%',
                  borderRadius: '16px 16px 0 0',
                },
        }}
      >
        <SheetGrabber onClose={closeDrawer} />
        {editing ? (
          <div className="ubr-pane">
            <SpotEditor
              editing={editing}
              mark={editing.id ? (ck.marks.find((m) => m.id === editing.id) ?? null) : null}
              onSave={(d) => void handleSave(d)}
              onCancel={closeDrawer}
              onDelete={() => editing.id && handleRemove(editing.id)}
            />
          </div>
        ) : selected ? (
          <div className="ubr-pane">
            <SpotSheet
              poi={activePoi}
              mark={activeMark}
              isAdmin={admin.authed}
              onAddFromPoi={handleAddFromPoi}
              onEditMark={(id) => setEditing({ id, lng: activeMark?.lng ?? 0, lat: activeMark?.lat ?? 0 })}
              onToggleDone={(id) => {
                if (admin.authed) ck.toggleDone(id)
                else notify('标记完成需要管理员权限', 'warn')
              }}
              onRemoveMark={handleRemove}
              onClose={closeDrawer}
              routeSeq={routeSeq}
              onZoom={(src) => {
                // 详情里的描述被限行截断，大图下方给出完整内容
                const m = selected?.kind === 'checkin' ? ck.marks.find((x) => x.id === selected.id) : null
                const p = selected?.kind === 'poi' ? POIS.find((x) => x.id === selected.id) : null
                setViewer({
                  src,
                  title: m?.name || p?.name || '查看大图',
                  note: (m?.note || '').trim() || undefined,
                })
              }}
              fallbackImg={
                activeMark?.fromPoi
                  ? POIS.find((p) => p.id === activeMark.fromPoi)?.img
                  : undefined
              }
            />
          </div>
        ) : listOpen ? (
          <div className="ubr-list-view">
            <div style={{ flex: 'none' }}>
              {/* 原 header 的标题与关闭入口，收进内容区，避免多出 60px 白边 */}
              <Group gap={8} px={14} pt={10} pb={0} wrap="nowrap" justify="space-between">
                <Text fw={600} size="sm">
                  点位列表
                </Text>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label="收起"
                  onClick={closeDrawer}
                >
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </ActionIcon>
              </Group>
              <Group gap={8} px={14} pt={6} pb={2} wrap="nowrap">
                <TextInput
                  // 搜索框比表单输入框矮一档：它只是筛选器，主题默认的 md 偏高
                  size="sm"
                  placeholder="搜索点位或打卡点…"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  leftSection={icon('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-3.5-3.5', 14)}
                  rightSection={
                    query ? (
                      <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setQuery('')}>
                        ×
                      </ActionIcon>
                    ) : null
                  }
                  styles={{ input: { height: 34, minHeight: 34 } }}
                  style={{ flex: 1 }}
                />
              </Group>
              <CategoryTabs
                value={tab}
                onChange={setTab}
                poiCounts={poiCounts}
                poiTotal={POIS_OK.length}
                mineCount={ck.marks.length}
                mineDone={ck.marks.filter((m) => m.done).length}
              />
            </div>
            <SpotList
              tab={tab === MY_CAT ? MY_CAT : 'all'}
              pois={tab === MY_CAT ? [] : listedPois}
              marks={tab === MY_CAT || tab === 'all' ? listedMarks : []}
              selectedKey={selectedKey}
              routeSeq={routeSeq}
              isAdmin={admin.authed}
              onPickPoi={openPoi}
              onPickMark={openMark}
              onAddFromPoi={handleAddFromPoi}
              onToggleDone={(id) => void guard(() => ck.toggleDone(id))}
              onRemoveMark={handleRemove}
            />
          </div>
        ) : null}
      </Drawer>

      {ck.error && (
        <div className="ubr-conn-error">
          <div>
            <Text size="xs" fw={600}>无法连接服务端</Text>
            <Text size="xs" c="dimmed">{ck.error}</Text>
          </div>
          <Button size="compact-xs" color="red" onClick={() => void ck.refresh()}>
            重试
          </Button>
        </div>
      )}

      <PhotoViewer
        src={viewer?.src ?? null}
        title={viewer?.title ?? ''}
        note={viewer?.note}
        onClose={() => setViewer(null)}
      />

      {toast && <div className={`ubr-toast${toast.kind === 'warn' ? ' warn' : ''}`}>{toast.text}</div>}
    </div>
  )
}