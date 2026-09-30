import { ActionIcon, Tooltip } from '@mantine/core'
import type { CSSProperties } from 'react'
import { ConfirmPopover } from './ConfirmPopover'
import { BRAND, CAT_MAP, kindsText, OK, showsSeq } from '../constants'
import type { Checkin, Poi } from '../types'

interface Props {
  tab: string
  pois: Poi[]
  marks: Checkin[]
  selectedKey: string | null
  /** 路线点的显示序号；只有路线类型会用到 */
  routeSeq: Record<string, number>
  isAdmin: boolean
  onPickPoi: (p: Poi) => void
  onPickMark: (id: string) => void
  onAddFromPoi: (p: Poi) => void
  onToggleDone: (id: string) => void
  /** 删除打卡点（官方点位不可删，只传打卡点） */
  onRemoveMark: (id: string) => void
}

/**
 * 统一列表：官方点位与「我的打卡」共用同一套行样式，
 * 由顶部分类 tag 决定展示哪一类，不再为打卡点单开一个底部区块。
 */
export function SpotList({
  tab,
  pois,
  marks,
  selectedKey,
  routeSeq,
  isAdmin,
  onPickPoi,
  onPickMark,
  onAddFromPoi,
  onToggleDone,
  onRemoveMark,
}: Props) {
  const showMarks = tab === 'mine'
  const showPois = !showMarks

  const empty = (
    <div className="ubr-empty">
      {showMarks ? (
        <>
          <div>还没有打卡点</div>
          {isAdmin && (
            <div style={{ marginTop: 8 }}>
              点地图右上角「添加打卡点」，
              <br />
              再点地图任意位置即可落点
            </div>
          )}
        </>
      ) : (
        <div>没有匹配的点位</div>
      )}
    </div>
  )

  if (showMarks) {
    if (!marks.length) return empty
    const sorted = [...marks].sort(
      (a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.seq || 0) - (b.seq || 0),
    )
    return (
      <div className="ubr-list">
        {sorted.map((m, index) => {
          const key = `ck:${m.id}`
          const thumb = m.photoUrl
          return (
            <div
              key={m.id}
              className={`ubr-row${m.done ? ' done' : ''}${selectedKey === key ? ' active' : ''}`}
              style={{ '--row-index': index } as CSSProperties}
              onClick={() => onPickMark(m.id)}
            >
              {thumb ? (
                <img className="ubr-row-thumb" src={thumb} alt="" />
              ) : (
                <span className="ubr-row-dot" style={{ background: m.done ? OK : BRAND }} />
              )}
              <div className="ubr-row-main">
                <div className="ubr-row-name">
                  {/* 只有路线类型带序号：它表达走访顺序，其余类型序号没有信息量 */}
                  {showsSeq(m.kinds ?? [m.kind]) && routeSeq[m.id] ? `${routeSeq[m.id]}. ` : ''}
                  {m.name || '未命名'}
                </div>
                <div className="ubr-row-meta">
                  <span>{kindsText(m.kinds ?? [m.kind])}</span>
                  {m.rating > 0 && <span className="star">{'★'.repeat(m.rating)}</span>}
                  {m.note && (
                    <span className="mono">
                      {m.note.slice(0, 12)}
                      {m.note.length > 12 ? '…' : ''}
                    </span>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="ubr-row-acts">
                  <Tooltip label={m.done ? '取消完成' : '标记完成'} withArrow>
                    <ActionIcon
                      size="md"
                      variant="subtle"
                      color={m.done ? 'gray' : 'green'}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleDone(m.id)
                      }}
                    >
                      <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </ActionIcon>
                  </Tooltip>
                  <ConfirmPopover
                    position="left"
                    title="删除这个打卡点？"
                    description={m.name || '未命名打卡点'}
                    onConfirm={() => onRemoveMark(m.id)}
                  >
                    <Tooltip label="删除" withArrow>
                      <ActionIcon size="md" variant="subtle" color="red" aria-label="删除打卡点">
                        <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                        </svg>
                      </ActionIcon>
                    </Tooltip>
                  </ConfirmPopover>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (!showPois || !pois.length) return empty

  return (
    <div className="ubr-list">
      {pois.map((poi, index) => {
        const cat = CAT_MAP[poi.cat]
        const bad = poi.coordValid === false
        const key = `poi:${poi.id}`
        return (
          <div
            key={poi.id}
            className={`ubr-row${bad ? ' invalid' : ''}${selectedKey === key ? ' active' : ''}`}
            style={{ '--row-index': index } as CSSProperties}
            onClick={() => !bad && onPickPoi(poi)}
            title={bad ? '官网数据经纬度字段错填，无有效坐标' : undefined}
          >
            {poi.img && !bad ? (
              <img className="ubr-row-thumb" src={poi.img} alt="" loading="lazy" />
            ) : (
              <span className="ubr-row-dot" style={{ background: bad ? '#c9c3b8' : cat?.color }} />
            )}
            <div className="ubr-row-main">
              <div className="ubr-row-name">{poi.name}</div>
              <div className="ubr-row-meta">
                <span>{cat?.label ?? poi.cat}</span>
                {poi.land && <span className="mono">{poi.land}</span>}
                {bad && <span className="warn">坐标缺失</span>}
              </div>
            </div>
            {isAdmin && !bad && (
              <div className="ubr-row-acts">
                <Tooltip label="加入打卡清单" withArrow>
                  <ActionIcon
                    size="md"
                    variant="subtle"
                    color="sky"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddFromPoi(poi)
                    }}
                  >
                    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </ActionIcon>
                </Tooltip>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
