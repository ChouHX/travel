import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Group, Image, Rating, Stack, TagsInput, Text, Textarea, TextInput } from '@mantine/core'
import { KINDS, ROUTE_KIND } from '../constants'
import type { Checkin, Editing } from '../types'
import { compressToWebp, fmtBytes, type CompressedImage } from '../lib/image'

export interface EditorResult {
  name: string
  note: string
  rating: number
  /** 类型标签，第一个为主类型 */
  kinds: string[]
  /** 本次新选并压缩好的照片；undefined 表示未改动 */
  photo?: CompressedImage
  photoCleared?: boolean
}

interface Props {
  editing: Editing
  mark: Checkin | null
  onSave: (data: EditorResult) => void
  onCancel: () => void
  onDelete: () => void
}

const icon = (path: string, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
)

/** 打卡点编辑表单（管理员）。照片在本地压缩后转 WebP，再交给 IndexedDB 保存。 */
export function SpotEditor({ editing, mark, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [rating, setRating] = useState(0)
  const [kinds, setKinds] = useState<string[]>([KINDS[0]])
  const [photo, setPhoto] = useState<CompressedImage | null>(null)
  const [photoCleared, setPhotoCleared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  /** 刚从剪贴板读到图片时的短暂高亮反馈 */
  const [justPasted, setJustPasted] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const existingUrl = photoCleared ? undefined : mark?.photoUrl

  // 粘贴监听是常驻的，闭包里拿不到最新的 busy，用 ref 同步
  const busyRef = useRef(false)
  busyRef.current = busy

  useEffect(() => {
    setName(mark?.name ?? '')
    setNote(mark?.note ?? '')
    setRating(mark?.rating ?? 0)
    setKinds(mark?.kinds?.length ? mark.kinds : [mark?.kind ?? KINDS[0]])
    setPhoto(null)
    setPhotoCleared(false)
    setErr(null)
  }, [mark, editing.id])

  // 新选照片的本地预览
  useEffect(() => {
    if (!photo) {
      setPreview(null)
      return
    }
    const u = URL.createObjectURL(photo.blob)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])

  const pick = useCallback(async (file: File | null, fromPaste = false) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErr('粘贴的内容不是图片')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const out = await compressToWebp(file)
      setPhoto(out)
      setPhotoCleared(false)
      if (fromPaste) {
        setJustPasted(true)
        window.setTimeout(() => setJustPasted(false), 1200)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片处理失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  /**
   * 支持直接粘贴截图（桌面端截图后 Ctrl/⌘ + V 即可）。
   *
   * 监听挂在 document 上，不需要先点中某个元素 —— 截图工具把图放进剪贴板后，
   * 用户的心智是"随手粘一下"，要求先聚焦到特定输入框会显得别扭。
   * 只有剪贴板里确实带图片时才拦截，纯文本粘贴照常交给输入框。
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      let file: File | null = null
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          file = it.getAsFile()
          if (file) break
        }
      }
      if (!file) return                 // 没有图片就不干预（普通文本粘贴）

      e.preventDefault()
      if (busyRef.current) {
        setErr('上一张图片还在处理，请稍候')
        return
      }
      void pick(file, true)
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [pick])

  const shownUrl = preview ?? existingUrl
  const hasPhoto = !!shownUrl

  return (
    <Stack gap={14}>
      <Text size="sm" fw={600}>
        {editing.id ? '编辑打卡点' : '新建打卡点'}
      </Text>

      <TextInput
        label="名称"
        placeholder="例如：霍格沃茨城堡正面机位"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />

      <div>
        <TagsInput
          label="类型"
          description="可输入自定义类型；第一个为「主类型」，决定地图上的配色"
          placeholder="回车添加，也可从下拉里选"
          value={kinds}
          onChange={(v) => setKinds(v.slice(0, 6))}
          data={KINDS}
          maxTags={6}
          maxLength={20}
          clearable
          splitChars={[',', '，', '、', ' ']}
          styles={{ label: { fontSize: 10, letterSpacing: '0.1em', color: 'var(--ubr-ink-faint)' } }}
        />
        <Text size="xs" c="dimmed" mt={4}>
          选「{ROUTE_KIND}」时地图上会显示走访序号，其余类型显示为缩略图卡片
        </Text>
      </div>

      <div>
        <Text size="xs" c="dimmed" mb={4}>
          拍摄优先级
        </Text>
        <Rating value={rating} onChange={setRating} color="sky" size="md" />
      </div>

      <Textarea
        label="备注 / 拍摄要点"
        placeholder="最佳时段、机位朝向、焦段、排队情况…"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        autosize
        minRows={3}
        maxRows={8}
      />

      <div>
        <Text size="xs" c="dimmed" mb={6}>
          实拍照片
        </Text>

        {hasPhoto ? (
          <Stack gap={8}>
            <Image src={shownUrl} radius="md" alt="" style={{ maxHeight: 240, objectFit: 'contain' }} />
            <Group gap={8}>
              <Button variant="light" color="gray" onClick={() => fileRef.current?.click()} loading={busy}>
                更换
              </Button>
              <Button
                variant="subtle"
                color="red"
                onClick={() => {
                  setPhoto(null)
                  setPhotoCleared(true)
                }}
              >
                移除
              </Button>
            </Group>
            {photo && (
              <Text size="xs" c="green">
                已压缩为 {photo.type.includes('webp') ? 'WebP' : 'JPEG'} · {photo.width}×{photo.height} ·{' '}
                {fmtBytes(photo.bytes)}（原始 {fmtBytes(photo.originalBytes)}）
              </Text>
            )}
            <Text size="xs" c="dimmed">
              也可以直接粘贴截图替换（Ctrl/⌘ + V）
            </Text>
          </Stack>
        ) : (
          // 整块区域都可点击，同时也是粘贴目标 —— 桌面端截图后直接 Ctrl/⌘+V 即可
          <button
            type="button"
            className={`ubr-photo-drop${justPasted ? ' flash' : ''}`}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <span className="ico">{icon('M12 5v14M5 12h14', 20)}</span>
            <span className="t1">
              {busy ? '压缩中…' : justPasted ? '已读取剪贴板图片' : '选择照片'}
            </span>
            <span className="t2">或直接粘贴截图（Ctrl/⌘ + V）</span>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void pick(e.currentTarget.files?.[0] ?? null)}
        />
        <Text size="xs" c="dimmed" mt={6}>
          照片会先在本地压缩（长边 1600px）并转为 WebP，再上传到服务端与他人共享
        </Text>
        {err && (
          <Text size="xs" c="red" mt={4}>
            {err}
          </Text>
        )}
      </div>

      <Group gap={8} mt={2}>
        <Button
          color="sky"
          style={{ flex: 1 }}
          onClick={() => onSave({ name, note, rating, kinds, photo: photo ?? undefined, photoCleared })}
          disabled={busy}
        >
          保存
        </Button>
        <Button variant="light" color="gray" onClick={onCancel}>
          取消
        </Button>
        {editing.id && (
          <Button variant="subtle" color="red" onClick={onDelete}>
            删除
          </Button>
        )}
      </Group>
    </Stack>
  )
}
