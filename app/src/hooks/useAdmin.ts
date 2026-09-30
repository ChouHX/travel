import { useCallback, useEffect, useState } from 'react'
import { api, loadToken, saveToken } from '../lib/api'

export interface AuthResult {
  ok: boolean
  message?: string
}

/**
 * 管理员会话。
 *
 * 与旧版的关键差别：口令校验完全在服务端，浏览器只保存一个 token。
 * 旧实现把 SHA-256 摘要放在 localStorage 里自己比对 —— 那样看过源码就能绕过，
 * 现在权限由接口强制，才真正能挡住未授权的写入。
 */
export function useAdmin() {
  const [authed, setAuthed] = useState(false)
  /** 是否已向服务端确认过登录状态（避免首屏闪烁） */
  const [ready, setReady] = useState(false)
  const [usingDefault, setUsingDefault] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!loadToken()) {
      setReady(true)
      return
    }
    api.me()
      .then((r) => {
        if (cancelled) return
        setAuthed(r.authenticated)
        setUsingDefault(r.usingDefaultPassword)
      })
      .catch(() => { if (!cancelled) setAuthed(false) })
      .finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (password: string): Promise<AuthResult> => {
    try {
      const { token } = await api.login(password)
      saveToken(token)
      setAuthed(true)
      const me = await api.me().catch(() => null)
      if (me) setUsingDefault(me.usingDefaultPassword)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '登录失败' }
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* token 可能已过期或被服务端清理，本地照常退出 */
    }
    saveToken(null)
    setAuthed(false)
  }, [])

  const changePassword = useCallback(async (current: string, next: string): Promise<AuthResult> => {
    try {
      await api.changePassword(current, next)
      setUsingDefault(false)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '修改失败' }
    }
  }, [])

  /** 会话在服务端过期时（例如被别的设备踢掉），由界面调用它回到未登录态 */
  const markExpired = useCallback(() => {
    saveToken(null)
    setAuthed(false)
  }, [])

  return { authed, ready, usingDefault, login, logout, changePassword, markExpired }
}