import { useState, type ReactNode } from 'react'
import { Button, Group, Popover, Text } from '@mantine/core'

interface Props {
  /** 触发元素（按钮/图标） */
  children: ReactNode
  /** 确认后执行 */
  onConfirm: () => void
  title?: string
  description?: string
  confirmLabel?: string
  /** 危险操作用红色按钮 */
  danger?: boolean
  position?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * 二次确认气泡。
 *
 * 不用 window.confirm：它是阻塞式的浏览器原生弹窗，样式与应用割裂，在移动端还会
 * 打断页面上下文。这里用 Popover 就地确认，点外部即可取消。
 * （项目未引入 @mantine/modals，独立实现比多装一个包更划算。）
 */
export function ConfirmPopover({
  children,
  onConfirm,
  title = '确认删除？',
  description,
  confirmLabel = '删除',
  danger = true,
  position = 'top',
}: Props) {
  const [opened, setOpened] = useState(false)

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position={position}
      withArrow
      shadow="md"
      radius="md"
      width={200}
      trapFocus={false}
      withinPortal
    >
      <Popover.Target>
        <div
          onClick={(e) => {
            // 阻止冒泡：列表行本身绑定了"点开详情"，删除按钮不应触发它
            e.stopPropagation()
            setOpened((v) => !v)
          }}
          style={{ display: 'inline-flex' }}
        >
          {children}
        </div>
      </Popover.Target>

      <Popover.Dropdown
        p="xs"
        onClick={(e) => e.stopPropagation()}
      >
        <Text size="xs" fw={600} mb={description ? 2 : 8}>
          {title}
        </Text>
        {description && (
          <Text size="xs" c="dimmed" mb={8} lineClamp={2}>
            {description}
          </Text>
        )}
        <Group gap={6} justify="flex-end">
          <Button size="compact-xs" variant="default" onClick={() => setOpened(false)}>
            取消
          </Button>
          <Button
            size="compact-xs"
            color={danger ? 'red' : 'sky'}
            onClick={() => {
              setOpened(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}