import { useState } from 'react'
import { Alert, Button, Card, Center, PasswordInput, Stack, Text, Title } from '@mantine/core'
import type { AuthResult } from '../hooks/useAdmin'

interface Props {
  onLogin: (pass: string) => Promise<AuthResult>
  onBack: () => void
  /** 服务端仍在用初始口令时给出提示（口令本身只在服务端，前端不再硬编码） */
  usingDefault: boolean
}

export function AdminGate({ onLogin, onBack, usingDefault }: Props) {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!pass || busy) return
    setBusy(true)
    setErr(null)
    const res = await onLogin(pass)
    setBusy(false)
    if (!res.ok) {
      setErr(res.message ?? '口令不正确')
      setPass('')
    }
  }

  return (
    <Center mih="100dvh" p="md" style={{ background: 'var(--ubr-bg)' }}>
      <Card w="100%" maw={400} p="xl" radius="lg" withBorder shadow="sm">
        <Stack gap="lg">
          <div>
            <Title order={3} mb={6}>
              管理员登录
            </Title>
            <Text size="sm" c="dimmed">
              登录后可添加打卡点位、上传实拍照片、导入导出数据。
            </Text>
          </div>

          <PasswordInput
            label="访问口令"
            placeholder="请输入口令"
            value={pass}
            onChange={(e) => setPass(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            data-autofocus
            size="md"
          />

          {err && (
            <Alert color="red" variant="light" p="xs">
              {err}
            </Alert>
          )}

          {usingDefault && (
            <Alert color="sky" variant="light" p="xs" icon={null}>
              <Text size="xs">
                服务端仍在使用初始口令。它由服务端配置（启动时会打印提示），
                登录后请在管理页尽快修改。
              </Text>
            </Alert>
          )}

          <Stack gap={8}>
            <Button color="sky" size="md" onClick={() => void submit()} loading={busy}>
              登录
            </Button>
            <Button variant="subtle" color="gray" onClick={onBack}>
              返回地图
            </Button>
          </Stack>

          <Text size="xs" c="dimmed">
            口令由服务端校验，浏览器只保存登录凭证。未登录访客仍可浏览地图和所有已标注的点位，
            但无法增删改。
          </Text>
        </Stack>
      </Card>
    </Center>
  )
}