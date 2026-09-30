/**
 * 北京环球度假区打卡地图 · 服务端
 *
 * 职责：
 *  - 提供打卡点的共享存储（这是"别人能看到我标的点"的关键）
 *  - 照片上传与分发
 *  - 管理员认证（服务端强制，不再依赖浏览器里的校验）
 *  - 托管前端产物与地图瓦片/缩略图
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UPLOAD_DIR, DB_PATH, DATA_DIR, normalizeKinds,
  listCheckins, getCheckin, createCheckin, updateCheckin, deleteCheckin,
  clearAllCheckins, countCheckins, removePhotoFile,
} from './db.mjs'
import {
  ensureAdminPassword, isUsingDefaultPassword, checkAdminPassword, changeAdminPassword,
  issueToken, verifyToken, revokeToken, revokeOtherTokens, cleanupSessions,
  SESSION_TTL_MS,
} from './auth.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC_DIR = process.env.UBR_PUBLIC_DIR || path.join(__dirname, 'public')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_PHOTO_BYTES = Number(process.env.UBR_MAX_PHOTO_MB || 8) * 1024 * 1024
const CORS_ORIGIN = process.env.UBR_CORS_ORIGIN || ''

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)

if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
}

app.use(express.json({ limit: '1mb' }))

if (!process.env.UBR_QUIET) {
  app.use((req, res, next) => {
    const t0 = Date.now()
    res.on('finish', () => {
      const ms = Date.now() - t0
      if (req.path.startsWith('/api') || ms > 300) {
        console.log(`${res.statusCode} ${req.method} ${req.originalUrl} ${ms}ms`)
      }
    })
    next()
  })
}

/* ---------------- 工具 ---------------- */

const bearer = (req) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')
  return m ? m[1].trim() : ''
}

const requireAdmin = (req, res, next) => {
  const session = verifyToken(bearer(req))
  if (!session) {
    return res.status(401).json({ error: 'unauthorized', message: '需要管理员登录' })
  }
  req.session = session
  next()
}

const fail = (status, message) => {
  const err = new Error(message)
  err.status = status
  return err
}

const clampStr = (v, max) => String(v ?? '').slice(0, max)
const asInt = (v, min, max, dflt) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 只接受可信字段，避免客户端塞进任意键值 */
function sanitizeCheckinInput(body, { partial = false } = {}) {
  const out = {}
  const has = (k) => Object.prototype.hasOwnProperty.call(body ?? {}, k)

  if (!partial || has('name')) out.name = clampStr(body?.name, 120).trim()
  if (!partial || has('note')) out.note = clampStr(body?.note, 2000).trim()
  if (!partial || has('rating')) out.rating = asInt(body?.rating, 0, 5, 0)
  // 类型标签：支持多个自定义标签。kind 由 db 层从 kinds[0] 派生，这里不再单独收。
  if (!partial || has('kinds') || has('kind')) {
    const raw = has('kinds') ? body.kinds : (body.kind ? [body.kind] : [])
    const kinds = normalizeKinds(raw)
    out.kinds = kinds.length ? kinds : ['其他']
  }
  if (!partial || has('done')) out.done = !!body?.done
  if (!partial || has('fromPoi')) out.fromPoi = body?.fromPoi ? clampStr(body.fromPoi, 40) : null

  if (!partial || has('lng') || has('lat')) {
    const lng = Number(body?.lng)
    const lat = Number(body?.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      throw fail(400, '经纬度不合法')
    }
    out.lng = Number(lng.toFixed(7))
    out.lat = Number(lat.toFixed(7))
  }
  return out
}

/** 从魔数判断图片类型 —— 不信任客户端给的 content-type */
function sniffImage(buf) {
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF'
      && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' }
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length > 8 && buf.subarray(0, 8).equals(PNG)) {
    return { ext: 'png', mime: 'image/png' }
  }
  return null
}

/* ---------------- 健康检查 / 认证 ---------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    checkins: countCheckins(),
    usingDefaultPassword: isUsingDefaultPassword(),
    requiresAdminToEdit: true,
  })
})

app.post('/api/auth/login', (req, res) => {
  if (!checkAdminPassword(req.body?.password)) {
    return res.status(401).json({ error: 'bad_password', message: '口令不正确' })
  }
  const { token, expiresAt } = issueToken()
  res.json({ token, expiresAt, ttlMs: SESSION_TTL_MS })
})

app.get('/api/auth/me', (req, res) => {
  const session = verifyToken(bearer(req))
  res.json({
    authenticated: !!session,
    expiresAt: session?.expiresAt ?? null,
    usingDefaultPassword: isUsingDefaultPassword(),
  })
})

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  revokeToken(req.session.token)
  res.json({ ok: true })
})

app.post('/api/auth/password', requireAdmin, (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {}
    if (!checkAdminPassword(currentPassword)) {
      throw fail(400, '当前口令不正确')
    }
    const next = String(newPassword ?? '')
    if (next.length < 6) throw fail(400, '新口令至少 6 位')
    changeAdminPassword(next)
    // 改完把其它设备的登录全部作废，只保留当前会话
    revokeOtherTokens(req.session.token)
    res.json({ ok: true, usingDefaultPassword: false })
  } catch (e) { next(e) }
})

/* ---------------- 打卡点 ---------------- */

app.get('/api/checkins', (req, res) => {
  const results = listCheckins()
  res.json({ results, count: results.length })
})

app.post('/api/checkins', requireAdmin, (req, res, next) => {
  try {
    const created = createCheckin(sanitizeCheckinInput(req.body))
    res.status(201).json(created)
  } catch (e) { next(e) }
})

/** 批量导入：本机旧数据迁移、或从别人的导出文件合并 */
app.post('/api/checkins/import', requireAdmin, (req, res, next) => {
  try {
    const points = Array.isArray(req.body?.points) ? req.body.points : []
    if (!points.length) throw fail(400, '没有可导入的点位')
    if (points.length > 500) throw fail(400, '单次最多导入 500 个点位')

    const existing = new Set(listCheckins().map((c) => c.id))
    const added = []
    const skipped = []
    for (const p of points) {
      const id = String(p?.id ?? '')
      if (id && existing.has(id)) { skipped.push(id); continue }
      try {
        const created = createCheckin({ ...sanitizeCheckinInput(p), id: id || undefined })
        added.push(created)
        if (id) existing.add(id)
      } catch (e) {
        skipped.push(id || `(第 ${added.length + skipped.length + 1} 条)`)
      }
    }
    res.json({ added: added.length, skipped, results: added })
  } catch (e) { next(e) }
})

app.patch('/api/checkins/:id', requireAdmin, (req, res, next) => {
  try {
    const updated = updateCheckin(req.params.id, sanitizeCheckinInput(req.body, { partial: true }))
    if (!updated) throw fail(404, '打卡点不存在')
    res.json(updated)
  } catch (e) { next(e) }
})

app.delete('/api/checkins/:id', requireAdmin, (req, res, next) => {
  try {
    if (!deleteCheckin(req.params.id)) throw fail(404, '打卡点不存在')
    res.json({ ok: true })
  } catch (e) { next(e) }
})

app.delete('/api/checkins', requireAdmin, (req, res) => {
  const removed = clearAllCheckins()
  res.json({ ok: true, removed })
})

/* ---------------- 照片 ---------------- */

// 直接以图片二进制作为请求体，省掉 multipart 解析依赖
app.put(
  '/api/checkins/:id/photo',
  requireAdmin,
  express.raw({ type: () => true, limit: MAX_PHOTO_BYTES }),
  (req, res, next) => {
    try {
      const current = getCheckin(req.params.id)
      if (!current) throw fail(404, '打卡点不存在')

      const buf = Buffer.isBuffer(req.body) ? req.body : null
      if (!buf || buf.length < 64) throw fail(400, '照片数据为空')
      if (buf.length > MAX_PHOTO_BYTES) throw fail(413, '照片超出体积上限')

      const kind = sniffImage(buf)
      if (!kind) throw fail(415, '只接受 WebP / JPEG / PNG 图片')

      // 换格式时清掉旧扩展名的文件，避免同一 id 留下两个副本
      for (const ext of ['webp', 'jpg', 'png']) removePhotoFile(`${req.params.id}.${ext}`)

      const filename = `${req.params.id}.${kind.ext}`
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf)

      const updated = updateCheckin(req.params.id, {
        photo: filename,
        photoType: kind.mime,
        photoW: asInt(req.get('x-image-width'), 1, 20000, 0) || null,
        photoH: asInt(req.get('x-image-height'), 1, 20000, 0) || null,
        photoBytes: buf.length,
      })
      res.json(updated)
    } catch (e) { next(e) }
  },
)

app.delete('/api/checkins/:id/photo', requireAdmin, (req, res, next) => {
  try {
    const current = getCheckin(req.params.id)
    if (!current) throw fail(404, '打卡点不存在')
    removePhotoFile(`${req.params.id}.webp`)
    removePhotoFile(`${req.params.id}.jpg`)
    removePhotoFile(`${req.params.id}.png`)
    const updated = updateCheckin(req.params.id, {
      photo: null, photoType: null, photoW: null, photoH: null, photoBytes: null,
    })
    res.json(updated)
  } catch (e) { next(e) }
})

/* ---------------- 静态资源 ---------------- */

// 照片：文件名带 id，替换后 URL 上的 ?v= 会变，因此可以放心长缓存
app.use('/photos', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }))

// 地图瓦片：文件名与内容一一对应，长缓存
app.use('/tiles', express.static(path.join(ROOT, 'tiles'), { maxAge: '365d', immutable: true, fallthrough: true }))

// 官方点位缩略图与点位数据
app.use('/data', express.static(path.join(ROOT, 'data'), { maxAge: '7d', fallthrough: true }))

// 前端产物（Vite 输出，文件名带 hash，可长缓存）
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h', fallthrough: true }))

/* ---------------- 兜底 ---------------- */

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found', message: `无此接口: ${req.path}` })
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  const indexFile = path.join(PUBLIC_DIR, 'index.html')
  if (!fs.existsSync(indexFile)) {
    return res.status(503).type('text/plain; charset=utf-8')
      .send('前端尚未构建。请在 app/ 目录执行 npm run build，或直接用 npm run dev 开发。')
  }
  res.sendFile(indexFile)
})

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500)
  if (status >= 500) console.error('[error]', err.stack || err.message)
  res.status(status).json({ error: 'request_failed', message: err.message })
})

/* ---------------- 启动 ---------------- */

const firstBoot = ensureAdminPassword()
cleanupSessions()
setInterval(cleanupSessions, 3600_000).unref()

const server = app.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST
  const built = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
  console.log('北京环球度假区打卡地图 · 服务端')
  console.log(`  地址      http://${shown}:${PORT}`)
  console.log(`  数据目录  ${DATA_DIR}`)
  console.log(`  数据库    ${DB_PATH}`)
  console.log(`  前端产物  ${PUBLIC_DIR}${built ? '' : '  （尚未构建，仅 API 可用）'}`)
  if (firstBoot) {
    console.log(`  首次启动已初始化管理员口令，默认值见 UBR_ADMIN_PASSWORD（当前为 ${process.env.UBR_ADMIN_PASSWORD ? '环境变量指定值' : '内置默认值'}）`)
  }
  if (isUsingDefaultPassword()) {
    console.warn('  [警告] 仍在使用默认口令，请尽快在管理后台修改')
  }
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在关闭…`)
    server.close(() => process.exit(0))
  })
}