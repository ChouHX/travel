/**
 * 服务端 API 客户端。
 *
 * 打卡点现在存在服务端 —— 这是"别人能看见我标的点"的前提。
 * 之前的实现把数据放在 localStorage / IndexedDB，只有本机浏览器能看到。
 */
import type { Checkin, ExportPayload } from '../types'

const TOKEN_KEY = 'ubr_admin_token'

export function loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* 隐私模式下写入会失败，登录状态退化为本次会话内有效 */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = loadToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  // body 是 Blob（照片）时不能覆盖 content-type，交给调用方指定
  if (init.body && !(init.body instanceof Blob) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, '无法连接服务端，请确认服务已启动')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = null }
  }

  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `请求失败（HTTP ${res.status}）`
    throw new ApiError(res.status, message)
  }
  return data as T
}

export interface HealthInfo {
  ok: boolean
  checkins: number
  usingDefaultPassword: boolean
}

export interface MeInfo {
  authenticated: boolean
  expiresAt: string | null
  usingDefaultPassword: boolean
}

export interface ImportResult {
  added: number
  skipped: string[]
  results: Checkin[]
}

export const api = {
  health: () => request<HealthInfo>('/health'),

  login: (password: string) =>
    request<{ token: string; expiresAt: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  me: () => request<MeInfo>('/auth/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listCheckins: () => request<{ results: Checkin[]; count: number }>('/checkins'),
  createCheckin: (body: Partial<Checkin>) =>
    request<Checkin>('/checkins', { method: 'POST', body: JSON.stringify(body) }),
  updateCheckin: (id: string, patch: Partial<Checkin>) =>
    request<Checkin>(`/checkins/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCheckin: (id: string) =>
    request<{ ok: true }>(`/checkins/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearCheckins: () =>
    request<{ ok: true; removed: number }>('/checkins', { method: 'DELETE' }),
  importCheckins: (points: Partial<Checkin>[]) =>
    request<ImportResult>('/checkins/import', {
      method: 'POST',
      body: JSON.stringify({ points }),
    }),

  /** 直接以图片二进制作为请求体：省掉 multipart 解析，服务端也能更严地校验 */
  uploadPhoto: (id: string, blob: Blob, width: number, height: number) =>
    request<Checkin>(`/checkins/${encodeURIComponent(id)}/photo`, {
      method: 'PUT',
      body: blob,
      headers: {
        'content-type': blob.type || 'image/webp',
        'x-image-width': String(width),
        'x-image-height': String(height),
      },
    }),
  deletePhoto: (id: string) =>
    request<Checkin>(`/checkins/${encodeURIComponent(id)}/photo`, { method: 'DELETE' }),

  /** 导出仍走客户端生成：格式与旧版兼容，可再导入回来 */
  buildExportFile: async (withPhotos: boolean) => {
    const { results } = await api.listCheckins()
    const points = results as (Checkin & { photoBase64?: string })[]
    if (withPhotos) {
      await Promise.all(
        results.map(async (m, i) => {
          if (!m.photoUrl) return
          try {
            const res = await fetch(m.photoUrl)
            const blob = await res.blob()
            points[i].photoBase64 = await blobToBase64(blob)
          } catch { /* 单张失败不影响整体导出 */ }
        }),
      )
    }
    return {
      format: 'ubr-checkin',
      version: 3,
      exportedAt: new Date().toISOString(),
      crs: 'GCJ-02',
      count: points.length,
      source: 'server',
      points,
    } as ExportPayload & { source: string }
  },
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

export function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}