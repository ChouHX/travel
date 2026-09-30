/**
 * 认证与会话。
 *
 * 与之前最大的区别：以前口令校验完全在浏览器里（localStorage 存 SHA-256），
 * 看过源码的人可以直接跳过 —— 那时它只够"区分浏览与编辑"。
 * 现在改成服务端强制校验，接口层面就拦住了，才真正具备访问控制的意义。
 */
import crypto from 'node:crypto'
import { db, getSetting, setSetting } from './db.mjs'

const SETTING_KEY = 'admin_password'
const DEFAULT_PASSWORD = process.env.UBR_ADMIN_PASSWORD || 'ubr2024'
export const SESSION_TTL_MS =
  Number(process.env.UBR_SESSION_TTL_HOURS || 168) * 3600 * 1000

/** scrypt 参数：N=16384 在服务端约 50ms，足够抵挡离线爆破又不拖慢登录 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  })
  return `scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt}$${key.toString('hex')}`
}

export function verifyPassword(password, stored) {
  const m = /^scrypt\$([^$]+)\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(stored || '')
  if (!m) return false
  const params = Object.fromEntries(m[1].split(',').map((kv) => kv.split('=')))
  let key
  try {
    key = crypto.scryptSync(password, m[2], m[3].length / 2, {
      N: Number(params.N), r: Number(params.r), p: Number(params.p),
    })
  } catch {
    return false
  }
  const expected = Buffer.from(m[3], 'hex')
  return expected.length === key.length && crypto.timingSafeEqual(expected, key)
}

/** 首次启动写入默认口令的哈希；返回是否仍在使用默认口令 */
export function ensureAdminPassword() {
  if (getSetting(SETTING_KEY)) return false
  setSetting(SETTING_KEY, hashPassword(DEFAULT_PASSWORD))
  return true
}

export function isUsingDefaultPassword() {
  const stored = getSetting(SETTING_KEY)
  return !!stored && verifyPassword(DEFAULT_PASSWORD, stored)
}

export function checkAdminPassword(password) {
  return verifyPassword(String(password ?? ''), getSetting(SETTING_KEY))
}

export function changeAdminPassword(newPassword) {
  setSetting(SETTING_KEY, hashPassword(newPassword))
}

/* ---------- 会话 ---------- */

export function issueToken() {
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
    .run(token, now, now + SESSION_TTL_MS)
  return { token, expiresAt: new Date(now + SESSION_TTL_MS).toISOString() }
}

/** 校验 token，顺带续期（滑动过期，长期使用不必反复登录） */
export function verifyToken(token) {
  if (!token) return null
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
  if (!row) return null
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  const nextExpiry = Date.now() + SESSION_TTL_MS
  // 只在剩余寿命不足一半时写库，避免每个请求都产生一次写事务
  if (nextExpiry - row.expires_at > SESSION_TTL_MS / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(nextExpiry, token)
  }
  return { token, expiresAt: new Date(nextExpiry).toISOString() }
}

export function revokeToken(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/** 改口令后把其它会话全部踢掉（保留当前这一个） */
export function revokeOtherTokens(keepToken) {
  if (keepToken) db.prepare('DELETE FROM sessions WHERE token != ?').run(keepToken)
  else db.prepare('DELETE FROM sessions').run()
}

export function cleanupSessions() {
  const n = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes
  return n
}