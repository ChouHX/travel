import { ActionIcon, Button, Group, Tooltip } from '@mantine/core'
import { VisibilityPopover } from './VisibilityPopover'

const icon = (path: string, size = 15) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
)

interface Props {
  isAdmin: boolean
  armMode: boolean
  showLabels: boolean
  onToggleArm: () => void
  onToggleLabels: () => void
  onFit: () => void
  /** 显示管理（Popover）相关 */
  hidden: string[]
  onToggleHidden: (key: string) => void
  onSetAllHidden: (allHidden: boolean) => void
  poiCounts: Record<string, number>
  markTypes: { kind: string; count: number }[]
  mobile: boolean
}

/**
 * 地图工具栏：三个图标按钮与「添加打卡点」同处一行，添加按钮靠最右。
 * 最后一个图标（眼睛）点开是显示管理 Popover。
 */
export function MapToolbar({
  isAdmin,
  armMode,
  showLabels,
  onToggleArm,
  onToggleLabels,
  onFit,
  hidden,
  onToggleHidden,
  onSetAllHidden,
  poiCounts,
  markTypes,
  mobile,
}: Props) {
  return (
    <div className="ubr-map-tools">
      <Group gap={6} wrap="nowrap">
        <Tooltip label="显示点位名称" withArrow>
          <ActionIcon
            size="lg"
            variant={showLabels ? 'filled' : 'default'}
            color="sky"
            aria-label="显示点位名称"
            onClick={onToggleLabels}
            style={{ boxShadow: 'var(--ubr-shadow)' }}
          >
            {icon('M4 7h16M4 12h10M4 17h7')}
          </ActionIcon>
        </Tooltip>


        <Tooltip label="回到园区全景" withArrow>
          <ActionIcon
            size="lg"
            variant="default"
            aria-label="回到园区全景"
            onClick={onFit}
            style={{ boxShadow: 'var(--ubr-shadow)' }}
          >
            {icon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5')}
          </ActionIcon>
        </Tooltip>

        <VisibilityPopover
          hidden={hidden}
          onToggle={onToggleHidden}
          onSetAll={onSetAllHidden}
          poiCounts={poiCounts}
          markTypes={markTypes}
          mobile={mobile}
        />
      </Group>

      <div style={{ flex: 1, minWidth: 8 }} />

      {isAdmin && (
        <Button
          color="sky"
          variant={armMode ? 'filled' : 'light'}
          leftSection={icon('M12 5v14M5 12h14', 14)}
          onClick={onToggleArm}
          aria-label="添加打卡点"
          style={{ boxShadow: 'var(--ubr-shadow)', flex: 'none' }}
        >
          {armMode ? '点地图落点…' : '添加打卡点'}
        </Button>
      )}
    </div>
  )
}