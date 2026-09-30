import { Modal, ScrollArea, Stack, Text } from '@mantine/core'

interface Props {
  /** 要显示的图片地址；null 表示关闭 */
  src: string | null
  title: string
  /** 详情里被截断的描述，完整显示在图片下方（可滚动） */
  note?: string
  onClose: () => void
}

/**
 * 大图查看层。
 *
 * 独立成组件并挂在 App 层，是为了让 App 能在大图打开时关掉 Drawer 的 closeOnEscape ——
 * Mantine 的 ESC 监听注册在 window 的 capture 阶段，两个组件独立使用时
 * 同一个 ESC 会同时触发两边 onClose，表现为"看大图时按 ESC，详情也一起关了"。
 * 在 document 上做 capture 拦截是来不及的（window capture 更早），
 * 所以改为由上层显式协调。
 */
export function PhotoViewer({ src, title, note, onClose }: Props) {
  return (
    <Modal
      opened={!!src}
      onClose={onClose}
      size="auto"
      centered
      // Drawer 与 Modal 默认都是 z-index 200，并列会互相盖住；这里显式抬高
      zIndex={1000}
      title={title || '查看大图'}
      overlayProps={{ backgroundOpacity: 0.72, blur: 3 }}
      styles={{
        content: { background: 'transparent', boxShadow: 'none' },
        header: { background: 'transparent' },
        title: { color: '#fff', fontWeight: 600 },
        close: { color: '#fff' },
        body: { padding: 0 },
      }}
    >
      {src && (
        <Stack gap={0} align="center" className={note ? 'ubr-lightbox-hasnote' : undefined}>
          {/* 尺寸交给 CSS 限制在视口内，不设固定值。
              想放大看细节时用浏览器原生手势（触控板双指、浏览器缩放），
              比自己实现一套缩放更可靠，也符合用户直觉。 */}
          <img className="ubr-lightbox-img" src={src} alt={title} />

          {note && (
            <div className="ubr-lightbox-note">
              <Text size="xs" fw={600} mb={4} style={{ color: 'rgba(255,255,255,.75)' }}>
                描述
              </Text>
              <ScrollArea.Autosize mah={140} type="auto">
                <Text className="ubr-lightbox-note-txt">{note}</Text>
              </ScrollArea.Autosize>
            </div>
          )}
        </Stack>
      )}
    </Modal>
  )
}