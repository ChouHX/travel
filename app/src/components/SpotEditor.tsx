import { useEffect, useRef, useState } from 'react'
import { Button, Chip, Group, Image, Rating, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { KINDS } from '../constants'
import type { Checkin, Editing } from '../types'
import { compressToWebp, fmtBytes, type CompressedImage } from '../lib/image'

export interface EditorResult {
  name: string
  note: string
  rating: number
  kind: string
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
  const [kind, setKind] = useState<string>(KINDS[0])
  const [photo, setPhoto] = useState<CompressedImage | null>(null)
  const [photoCleared, setPhotoCleared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const existingUrl = photoCleared ? undefined : mark?.photoUrl

  useEffect(() => {
    setName(mark?.name ?? '')
    setNote(mark?.note ?? '')
    setRating(mark?.rating ?? 0)
    setKind(mark?.kind ?? KINDS[0])
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

  const pick = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const out = await compressToWebp(file)
      setPhoto(out)
      setPhotoCleared(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片处理失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

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
        <Text size="xs" c="dimmed" mb={6}>
          类型
        </Text>
        <Chip.Group value={kind} onChange={(v) => setKind(v as string)}>
          <Group gap={6}>
            {KINDS.map((k) => (
              <Chip key={k} value={k} variant="light" color="sky">
                {k}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
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
          </Stack>
        ) : (
          <Button
            variant="light"
            color="sky"
            leftSection={icon('M12 5v14M5 12h14')}
            onClick={() => fileRef.current?.click()}
            loading={busy}
            fullWidth
          >
            {busy ? '压缩中…' : '选择照片'}
          </Button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void pick(e.currentTarget.files?.[0] ?? null)}
        />
        <Text size="xs" c="dimmed" mt={6}>
          照片在本地压缩（长边 1600px）并转为 WebP，不会上传到任何服务器
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
          onClick={() => onSave({ name, note, rating, kind, photo: photo ?? undefined, photoCleared })}
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
