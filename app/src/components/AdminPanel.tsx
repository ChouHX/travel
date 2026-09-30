import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  FileButton,
  Group,
  PasswordInput,
  Progress,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core'
import type { Checkin } from '../types'
import type { AuthResult } from '../hooks/useAdmin'
import { fmtBytes } from '../lib/image'
import {
  clearLegacyLocalData,
  migrateLegacyToServer,
  readLegacyLocalData,
  type MigrateResult,
} from '../lib/legacy'

interface Props {
  marks: Checkin[]
  usingDefault: boolean
  onBack: () => void
  notify: (msg: string, kind?: 'ok' | 'warn') => void
  onRefresh: () => Promise<void>
  onExport: (withPhotos: boolean) => Promise<void>
  onImport: (file: File | null) => Promise<void>
  onChangePassword: (cur: string, next: string) => Promise<AuthResult>
  onLogout: () => void
  onClearMarks: () => Promise<void>
}

export function AdminPanel({
  marks,
  usingDefault,
  onBack,
  notify,
  onRefresh,
  onExport,
  onImport,
  onChangePassword,
  onLogout,
  onClearMarks,
}: Props) {
  const [withPhotos, setWithPhotos] = useState(true)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // 本机旧数据（迁移用）
  const [legacyCount, setLegacyCount] = useState<number | null>(null)
  const [legacyPhotos, setLegacyPhotos] = useState(0)
  const [migrating, setMigrating] = useState(false)
  const [migProgress, setMigProgress] = useState({ done: 0, total: 0 })
  const [migResult, setMigResult] = useState<MigrateResult | null>(null)

  useEffect(() => {
    readLegacyLocalData()
      .then((b) => { setLegacyCount(b.points.length); setLegacyPhotos(b.photoCount) })
      .catch(() => setLegacyCount(0))
  }, [])

  // 照片统计改为从服务端数据算（以前读的是本地 IndexedDB）
  const withPhoto = marks.filter((m) => m.photoUrl)
  const photoBytes = withPhoto.reduce((sum, m) => sum + (m.photoBytes ?? 0), 0)
  const done = marks.filter((m) => m.done).length

  const runMigrate = async () => {
    setMigrating(true)
    setMigResult(null)
    setMigProgress({ done: 0, total: legacyCount ?? 0 })
    try {
      const res = await migrateLegacyToServer((doneN, total) => setMigProgress({ done: doneN, total }))
      setMigResult(res)
      if (res.added > 0) {
        await onRefresh()
        notify(`已上传 ${res.added} 个本机标注${res.photos ? `、${res.photos} 张照片` : ''}`)
      } else if (res.skipped > 0) {
        notify('本机标注已全部存在于服务端', 'warn')
      } else {
        notify('本机没有可上传的数据', 'warn')
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : '上传失败', 'warn')
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--ubr-bg)', overflowY: 'auto' }}>
      <Container size={760} py="lg">
        <Group justify="space-between" mb="lg" wrap="nowrap">
          <div>
            <Title order={2}>管理后台</Title>
            <Text size="sm" c="dimmed">
              标注、照片与数据管理
            </Text>
          </div>
          <Group gap={8}>
            <Button variant="light" color="gray" onClick={onBack}>
              返回地图
            </Button>
            <Button variant="subtle" color="red" onClick={onLogout}>
              退出登录
            </Button>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="lg">
          {[
            { label: '打卡点', value: String(marks.length) },
            { label: '已完成', value: `${done} / ${marks.length}` },
            { label: '带照片', value: String(withPhoto.length) },
            { label: '照片占用', value: photoBytes ? fmtBytes(photoBytes) : '—' },
          ].map((s) => (
            <Card key={s.label} withBorder radius="md" p="md">
              <Text size="xs" c="dimmed">
                {s.label}
              </Text>
              <Text fw={700} size="xl" mt={4}>
                {s.value}
              </Text>
            </Card>
          ))}
        </SimpleGrid>

        <Stack gap="md">
          {/* 数据现在存在服务端，这里说明共享范围 */}
          <Alert variant="light" color="sky" icon={null}>
            <Text size="xs">
              打卡点与照片保存在<strong>服务端</strong>，所有访问者都能看到；只有登录管理员可以增删改。
              本页的改动会立即对其他人生效。
            </Text>
          </Alert>

          {/* 本机旧数据迁移 */}
          {legacyCount !== null && legacyCount > 0 && (
            <Card withBorder radius="lg" p="lg" style={{ borderColor: 'var(--ubr-brand)' }}>
              <Group justify="space-between" mb={6} wrap="nowrap">
                <Title order={4}>发现本机旧标注</Title>
                <Badge color="sky" variant="light">
                  {legacyCount} 条{legacyPhotos ? ` · ${legacyPhotos} 张照片` : ''}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" mb="md">
                这些是改造前存在浏览器本地的数据，只有这台设备能看到。
                上传后即可共享给其他人；重复上传不会产生副本（按 id 去重）。
              </Text>

              {migrating && (
                <Progress
                  value={migProgress.total ? (migProgress.done / migProgress.total) * 100 : 0}
                  mb="sm"
                  animated
                />
              )}

              <Group gap={8}>
                <Button color="sky" onClick={() => void runMigrate()} loading={migrating}>
                  上传到服务端
                </Button>
                <Button
                  variant="light"
                  color="gray"
                  disabled={migrating}
                  onClick={() => {
                    void clearLegacyLocalData().then(() => {
                      setLegacyCount(0)
                      setLegacyPhotos(0)
                      setMigResult(null)
                      notify('已清除本机旧数据')
                    })
                  }}
                >
                  丢弃本机数据
                </Button>
              </Group>

              {migResult && (
                <Alert mt="md" variant="light" color={migResult.failed.length ? 'orange' : 'green'} p="xs">
                  <Text size="xs">
                    上传 {migResult.added} 条，跳过 {migResult.skipped} 条（已存在），
                    照片 {migResult.photos} 张
                    {migResult.failed.length ? `，失败 ${migResult.failed.length} 条` : ''}
                  </Text>
                  {migResult.failed.slice(0, 3).map((f) => (
                    <Text size="xs" c="dimmed" key={f}>{f}</Text>
                  ))}
                </Alert>
              )}
            </Card>
          )}

          <Card withBorder radius="lg" p="lg">
            <Title order={4} mb={6}>
              数据导出
            </Title>
            <Text size="sm" c="dimmed" mb="md">
              导出为 JSON 备份，可再导入恢复或同步到另一套部署。勾选「包含照片」会把实拍照片
              一并以 base64 写入，文件会明显变大。
            </Text>
            <Switch
              checked={withPhotos}
              onChange={(e) => setWithPhotos(e.currentTarget.checked)}
              label="包含实拍照片"
              color="sky"
              mb="md"
            />
            <Group gap={8}>
              <Button color="sky" onClick={() => void onExport(withPhotos)} disabled={!marks.length}>
                导出 JSON
              </Button>
              <FileButton
                onChange={(f) => { void onImport(f) }}
                accept=".json,application/json"
              >
                {(p) => (
                  <Button variant="light" {...p}>
                    导入 JSON 合并
                  </Button>
                )}
              </FileButton>
            </Group>
          </Card>

          <Card withBorder radius="lg" p="lg">
            <Group justify="space-between" mb={6}>
              <Title order={4}>修改访问口令</Title>
              {usingDefault && (
                <Badge color="orange" variant="light">
                  正在使用初始口令
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed" mb="md">
              口令由服务端用 scrypt 加盐保存，明文不落盘。修改后其它设备的登录会立即失效。
            </Text>
            <Stack gap="sm" maw={380}>
              <PasswordInput
                label="当前口令"
                value={cur}
                onChange={(e) => setCur(e.currentTarget.value)}
                size="md"
              />
              <PasswordInput
                label="新口令（至少 6 位）"
                value={next}
                onChange={(e) => setNext(e.currentTarget.value)}
                size="md"
              />
              <Group>
                <Button
                  variant="light"
                  color="sky"
                  disabled={!cur || next.length < 6}
                  loading={busy}
                  onClick={() => {
                    setBusy(true)
                    void onChangePassword(cur, next).then((r) => {
                      setBusy(false)
                      setPwMsg({ ok: r.ok, text: r.ok ? '口令已更新' : (r.message ?? '修改失败') })
                      if (r.ok) { setCur(''); setNext('') }
                    })
                  }}
                >
                  更新口令
                </Button>
              </Group>
              {pwMsg && (
                <Alert color={pwMsg.ok ? 'green' : 'red'} variant="light" p="xs">
                  {pwMsg.text}
                </Alert>
              )}
            </Stack>
          </Card>

          <Card withBorder radius="lg" p="lg">
            <Title order={4} mb={6}>
              危险操作
            </Title>
            <Text size="sm" c="dimmed" mb="md">
              作用于服务端数据，<strong>所有访问者都会立即受影响</strong>。建议先导出备份。
            </Text>
            <Group gap={8}>
              <Button
                variant="light"
                color="red"
                disabled={!marks.length}
                onClick={() => {
                  if (window.confirm(`清空服务端全部 ${marks.length} 个打卡点？此操作不可撤销。`)) {
                    void onClearMarks()
                  }
                }}
              >
                清空全部打卡点
              </Button>
              <Button variant="light" color="gray" onClick={onBack}>
                返回地图查看
              </Button>
            </Group>
          </Card>

          <Divider label="导出格式" labelPosition="center" />

          <Card withBorder radius="lg" p="lg">
            <Text size="xs" ff="monospace" c="dimmed" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {`{
  "format": "ubr-checkin",
  "version": 3,
  "crs": "GCJ-02",
  "source": "server",
  "count": ${marks.length},
  "points": [
    {
      "id": "…", "seq": 1,
      "name": "霍格沃茨城堡正面机位",
      "kind": "必拍机位", "rating": 5,
      "note": "日落后蓝调，长焦压缩",
      "lng": …, "lat": …,
      "done": false,
      "photoUrl": "/photos/….webp?v=…",
      "photoBase64": "…（勾选包含照片时才有）"
    }
  ]
}`}
            </Text>
          </Card>
        </Stack>
      </Container>
    </div>
  )
}