import { Badge, Group } from '@mantine/core'
import { CATS, MY_CAT } from '../constants'

interface Props {
  /** 当前选中的分类；'all' 表示全部 */
  value: string
  onChange: (v: string) => void
  poiCounts: Record<string, number>
  poiTotal: number
  mineCount: number
  mineDone: number
}

/**
 * 分类标签（单选，tab 式）。
 *
 * 直接使用 Mantine 的 Badge 作为可点击标签：`component="button"` 让它成为按钮，
 * 左侧色点用 leftSection、数量用 rightSection，省掉一整套自定义样式。
 * 职责上只管"看哪一类"，"地图上显示哪几类"由工具栏的显示管理 Popover 负责。
 */
export function CategoryTabs({ value, onChange, poiCounts, poiTotal, mineCount, mineDone }: Props) {
  const items = [
    { key: 'all', label: '全部', color: null as string | null, n: poiTotal, mine: false, text: String(poiTotal) },
    ...CATS.map((c) => ({
      key: c.key,
      label: c.label,
      color: c.color as string | null,
      n: poiCounts[c.key] ?? 0,
      mine: false,
      text: String(poiCounts[c.key] ?? 0),
    })),
    {
      key: MY_CAT,
      label: '我的打卡',
      color: '#4a7fae' as string | null,
      n: mineCount,
      mine: true,
      text: `${mineDone}/${mineCount}`,
    },
  ]

  return (
    <Group gap={6} className="ubr-tabs" wrap="nowrap" role="tablist" aria-label="点位分类">
      {items.map((it) => {
        const on = value === it.key
        return (
          <Badge
            key={it.key}
            component="button"
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            size="lg"
            radius="md"
            variant={on ? 'filled' : 'light'}
            color={on ? (it.mine ? 'aqua' : 'sky') : 'gray'}
            className={`ubr-tab-badge${on ? ' on' : ''}`}
            leftSection={
              it.color ? (
                <span
                  className="ubr-badge-dot"
                  style={{
                    background: on ? 'currentColor' : it.color,
                    borderRadius: it.mine ? 2 : '50%',
                  }}
                />
              ) : null
            }
            rightSection={
              <span className="ubr-badge-n" style={{ opacity: on ? 0.85 : 0.6 }}>
                {it.text}
              </span>
            }
            styles={{
              root: { cursor: 'pointer', flex: 'none', textTransform: 'none', fontWeight: on ? 700 : 500 },
              label: { display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1 },
            }}
          >
            {it.label}
          </Badge>
        )
      })}
    </Group>
  )
}