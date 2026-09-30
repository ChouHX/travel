import { ActionIcon, Badge, Button, Group, Popover, ScrollArea, Stack, Switch, Text, Tooltip } from '@mantine/core'
import { kindVisibilityKey } from '../lib/checkins'
import { CATS, kindColorFor } from '../constants'

export const EYE_ICON =
  'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zm10 3a3 3 0 100-6 3 3 0 000 6z'

interface Props {
  /** 被隐藏（不在图上显示）的分类键集合 */
  hidden: string[]
  onToggle: (key: string) => void
  onSetAll: (allHidden: boolean) => void
  poiCounts: Record<string, number>
  markTypes: { kind: string; count: number }[]
  mobile: boolean
}

/**
 * 地图显示管理（Popover）。
 *
 * 放在工具栏图标按钮上而不是单独一个抽屉：它只调地图显隐，是个轻量开关，
 * 用 Popover 弹出更贴合"临时看一眼、随手改"的用法，也少一层全屏浮层。
 */
export function VisibilityPopover({
  hidden,
  onToggle,
  onSetAll,
  poiCounts,
  markTypes,
  mobile,
}: Props) {
  const items = [
    ...CATS.map((c) => ({
      key: c.key,
      label: c.label,
      color: c.color as string,
      n: poiCounts[c.key] ?? 0,
      mine: false,
    })),
    ...markTypes.map(({ kind, count }) => ({
      key: kindVisibilityKey(kind), label: kind, color: kindColorFor(kind), n: count, mine: true,
    })),
  ]

  const allHidden = items.every((it) => hidden.includes(it.key))
  const shown = items.filter((it) => !hidden.includes(it.key)).length

  return (
    <Popover
      width={mobile ? 268 : 300}
      position="bottom-start"
      shadow="md"
      radius="lg"
      withArrow
      arrowSize={8}
      trapFocus={false}
      withinPortal
    >
      <Popover.Target>
        <Tooltip label="地图显示管理" withArrow>
          <ActionIcon
            size="lg"
            variant={shown < items.length ? 'filled' : 'default'}
            color="sky"
            aria-label="地图显示管理"
            style={{ boxShadow: 'var(--ubr-shadow)' }}
          >
            <Group gap={0} wrap="nowrap">
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d={EYE_ICON} />
              </svg>
            </Group>
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p="sm">
        <Group justify="space-between" mb={6} wrap="nowrap">
          <Text fw={600} size="sm">
            地图显示
          </Text>
          <Badge size="xs" variant="light" color={shown < items.length ? 'sky' : 'gray'}>
            {shown} / {items.length}
          </Badge>
        </Group>

        <Text size="xs" c="dimmed" mb={4}>
          按类型控制地图显隐，不影响列表。多类型点位只要有一个类型开启就显示。
        </Text>

        <ScrollArea.Autosize mah={mobile ? '46vh' : 360} type="auto">
          <Stack gap={0}>
            {items.map((it) => {
              const on = !hidden.includes(it.key)
              return (
                <Switch
                  key={it.key}
                  checked={on}
                  onChange={() => onToggle(it.key)}
                  size="sm"
                  color={it.mine ? 'aqua' : 'sky'}
                  py={7}
                  styles={{ body: { alignItems: 'center' }, label: { width: '100%', cursor: 'pointer' } }}
                  label={
                    <Group justify="space-between" wrap="nowrap" gap="sm" style={{ width: '100%' }}>
                      <Group gap={7} wrap="nowrap">
                        <span
                          className="ubr-vis-dot"
                          style={{ background: on ? it.color : 'var(--ubr-line)', borderRadius: it.mine ? 2 : '50%' }}
                        />
                        <Text size="xs" fw={on ? 600 : 400} c={on ? undefined : 'dimmed'}>
                          {it.label}
                        </Text>
                      </Group>
                      <Badge size="xs" variant="light" color={on ? (it.mine ? 'aqua' : 'sky') : 'gray'}>
                        {it.n}
                      </Badge>
                    </Group>
                  }
                />
              )
            })}
          </Stack>
        </ScrollArea.Autosize>

        <Button variant="light" color="sky" size="compact-xs" fullWidth mt="sm" onClick={() => onSetAll(!allHidden)}>
          {allHidden ? '全部显示' : '全部隐藏'}
        </Button>
      </Popover.Dropdown>
    </Popover>
  )
}