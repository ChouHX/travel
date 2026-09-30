import { ActionIcon, Badge, Button, Group, Rating, Tooltip } from '@mantine/core'
import { BRAND, CAT_MAP, KIND_COLOR, OK, showsSeq } from '../constants'
import type { Checkin, Poi } from '../types'
import { ConfirmPopover } from './ConfirmPopover'

const icon = (path: string, size = 14) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
)

interface Props {
  poi?: Poi | null
  mark?: Checkin | null
  isAdmin: boolean
  onAddFromPoi: (poi: Poi) => void
  onEditMark: (id: string) => void
  onToggleDone: (id: string) => void
  /** 删除打卡点（仅自定义点位，官方点位数据不可删） */
  onRemoveMark: (id: string) => void
  /** 关闭详情（详情态没有 header，需自带关闭入口） */
  onClose: () => void
  /** 由官网点位转来的打卡点没有实拍图时，用它兜底显示官网缩略图 */
  fallbackImg?: string
  /** 路线点的显示序号；只有路线类型会用到 */
  routeSeq: Record<string, number>
}

/**
 * 点位详情（紧凑横向布局）。
 *
 * 竖排大图会把卡片撑得很高、盖住地图上的点位，所以改成左图右文的单行结构，
 * 外链按钮收进右上角。官方点位与打卡点共用同一套骨架。
 * 坐标属于内部数据，不在此展示。
 */
export function SpotSheet({ poi, mark, isAdmin, onAddFromPoi, onEditMark, onToggleDone, onRemoveMark, onClose, fallbackImg, routeSeq }: Props) {
  const photoUrl = mark?.photoUrl ?? fallbackImg

  const shell = (thumb: string | null | undefined, body: React.ReactNode, side?: React.ReactNode) => (
    <div className="ubr-detail">
      {/* 详情没有 header，关闭按钮内嵌在这里，避免顶部多出一条空白 */}
      <ActionIcon
        className="ubr-detail-close"
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="收起"
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </ActionIcon>
      <div className="ubr-detail-row">
        {thumb ? (
          <img className="ubr-detail-thumb" src={thumb} alt="" loading="lazy" />
        ) : (
          <div className="ubr-detail-thumb placeholder" />
        )}
        <div className="ubr-detail-txt">{body}</div>
        {side}
      </div>
    </div>
  )

  if (poi) {
    const cat = CAT_MAP[poi.cat]
    const meta = [poi.land, ...poi.tags].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)

    // 外链收进标题右侧的图标按钮：不再单独占一行/一列
    const titleNode = (
      <div className="ubr-detail-titleRow">
        <div className="ubr-detail-name">{poi.name}</div>
        {poi.url && (
          <Tooltip label="官网详情" withArrow position="left">
            <ActionIcon
              component="a"
              href={poi.url}
              target="_blank"
              rel="noreferrer"
              variant="light"
              color="sky"
              size="sm"
              radius="md"
              aria-label="打开官网详情"
              className="ubr-detail-extlink"
            >
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </ActionIcon>
          </Tooltip>
        )}
      </div>
    )

    return shell(
      poi.img,
      <>
        <div className="ubr-detail-kicker" style={{ color: cat?.color }}>
          {cat?.label ?? poi.cat}
        </div>
        {titleNode}
        {meta.length > 0 && <div className="ubr-detail-meta">{meta.join(' · ')}</div>}
        {isAdmin && (
          <Group gap={6} mt={10}>
            <Button size="compact-xs" color="sky" leftSection={icon('M12 5v14M5 12h14', 12)} onClick={() => onAddFromPoi(poi)}>
              加入打卡清单
            </Button>
          </Group>
        )}
      </>,
    )
  }

  if (mark) {
    const color = mark.done ? OK : (KIND_COLOR[mark.kind] ?? BRAND)

    const side = (
      <Badge size="sm" variant={mark.done ? 'filled' : 'light'} color={mark.done ? 'aqua' : 'sky'}>
        {mark.done ? '已打卡' : '待打卡'}
      </Badge>
    )

    return shell(
      photoUrl,
      <>
        <div className="ubr-detail-kicker" style={{ color }}>
          {mark.kind}
        </div>
        <div className="ubr-detail-name">
          {/* 同列表：序号只对路线类型有意义 */}
          {showsSeq(mark.kind) && routeSeq[mark.id] ? `${routeSeq[mark.id]}. ` : ''}
          {mark.name || '未命名打卡点'}
        </div>
        {mark.rating > 0 && (
          <Rating value={mark.rating} readOnly size="xs" color="sky" mt={2} mb={2} />
        )}
        {mark.note && <div className="ubr-detail-note">{mark.note}</div>}
        <Group gap={6} mt={10}>
          <Button
            size="compact-xs"
            variant={mark.done ? 'light' : 'filled'}
            color={mark.done ? 'gray' : 'aqua'}
            leftSection={icon('M20 6L9 17l-5-5', 12)}
            onClick={() => onToggleDone(mark.id)}
          >
            {mark.done ? '取消打卡' : '完成打卡'}
          </Button>
          {isAdmin && (
            <>
              <Button
                size="compact-xs"
                variant="light"
                color="gray"
                leftSection={icon('M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z', 12)}
                onClick={() => onEditMark(mark.id)}
              >
                编辑
              </Button>
              {/* 删除是破坏性操作，收进二次确认气泡，避免误触 */}
              <ConfirmPopover
                position="top"
                title="删除这个打卡点？"
                description={mark.name || '未命名打卡点'}
                onConfirm={() => onRemoveMark(mark.id)}
              >
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  aria-label="删除打卡点"
                  leftSection={icon('M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13', 12)}
                >
                  删除
                </Button>
              </ConfirmPopover>
            </>
          )}
        </Group>
      </>,
      side,
    )
  }

  return null
}