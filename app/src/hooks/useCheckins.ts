import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Checkin } from '../types'

/**
 * 轮询间隔。
 *
 * 用轮询而不是 WebSocket：这个应用写操作很少（只有管理员标注），
 * 读操作多且集中在打开页面时。20 秒一次 GET 的开销远小于维护长连接的复杂度，
 * 效果上足够 —— 别人标注完，你这边最多 20 秒就会出现。
 */
const POLL_MS = 20_000

export interface CheckinsState {
  marks: Checkin[]
  loading: boolean
  error: string | null
  refresh: (silent?: boolean) => Promise<void>
  create: (payload: Partial<Checkin>) => Promise<Checkin>
  update: (id: string, patch: Partial<Checkin>) => Promise<Checkin>
  remove: (id: string) => Promise<void>
  toggleDone: (id: string) => Promise<void>
  savePhoto: (id: string, blob: Blob, meta: { w: number; h: number }) => Promise<Checkin>
  removePhoto: (id: string) => Promise<Checkin>
  clearAll: () => Promise<number>
  importPoints: (points: Partial<Checkin>[]) => Promise<{ added: number; skipped: string[] }>
}

export function useCheckins(): CheckinsState {
  const [marks, setMarks] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 供 toggleDone 这类需要读取当前值的操作使用，避免闭包拿到过期数据
  const marksRef = useRef<Checkin[]>([])
  useEffect(() => { marksRef.current = marks }, [marks])

  const refresh = useCallback(async (silent = false) => {
    try {
      const { results } = await api.listCheckins()
      setMarks(results)
      setError(null)
    } catch (e) {
      // 静默刷新失败不打扰用户（例如临时断网）；只有首次加载才把错误显示出来
      if (!silent) setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh(false) }, [refresh])

  // 轮询 + 窗口聚焦时立即刷新：别人新增的点位会自动出现
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh(true)
    }
    const id = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  const replaceOne = useCallback((next: Checkin) => {
    setMarks((prev) => {
      const i = prev.findIndex((m) => m.id === next.id)
      if (i === -1) return [...prev, next]
      const copy = prev.slice()
      copy[i] = next
      return copy
    })
  }, [])

  const create = useCallback(async (payload: Partial<Checkin>) => {
    const created = await api.createCheckin(payload)
    setMarks((prev) => [...prev, created])
    return created
  }, [])

  const update = useCallback(
    async (id: string, patch: Partial<Checkin>) => {
      const next = await api.updateCheckin(id, patch)
      replaceOne(next)
      return next
    },
    [replaceOne],
  )

  const remove = useCallback(async (id: string) => {
    await api.deleteCheckin(id)
    setMarks((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const toggleDone = useCallback(
    async (id: string) => {
      const current = marksRef.current.find((m) => m.id === id)
      if (!current) return
      const next = await api.updateCheckin(id, { done: !current.done })
      replaceOne(next)
    },
    [replaceOne],
  )

  const savePhoto = useCallback(
    async (id: string, blob: Blob, meta: { w: number; h: number }) => {
      const next = await api.uploadPhoto(id, blob, meta.w, meta.h)
      replaceOne(next)
      return next
    },
    [replaceOne],
  )

  const removePhoto = useCallback(
    async (id: string) => {
      const next = await api.deletePhoto(id)
      replaceOne(next)
      return next
    },
    [replaceOne],
  )

  const clearAll = useCallback(async () => {
    const { removed } = await api.clearCheckins()
    setMarks([])
    return removed
  }, [])

  const importPoints = useCallback(async (points: Partial<Checkin>[]) => {
    const res = await api.importCheckins(points)
    await refresh(true)
    return { added: res.added, skipped: res.skipped }
  }, [refresh])

  return {
    marks, loading, error, refresh,
    create, update, remove, toggleDone,
    savePhoto, removePhoto, clearAll, importPoints,
  }
}