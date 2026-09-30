import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = path.resolve(import.meta.dirname, '..')

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/**
 * 开发模式下的共享静态资源。
 *
 * 瓦片与缩略图位于仓库根目录（与 app/ 同级），而 Vite 的 root 是 app/。
 * 构建时因为 outDir 指回根目录，相对路径恰好可用；但 dev server 只会去找
 * app/tiles、app/data，找不到就落到 SPA fallback —— 于是 /data/img/x.jpg 会
 * 返回 200 + text/html（index.html），<img> 解码失败，表现为「图片加载不出来」。
 *
 * 这里注册在 Vite 内建中间件之前（configureServer 主体内直接 use），
 * 命中 /tiles 与 /data 就直接由 node 读盘返回，并带上正确的 Content-Type。
 */
function serveSharedAssets(): Plugin {
  return {
    name: 'ubr-serve-shared-assets',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        const m = /^\/(tiles|data)\/(.+)$/.exec(url)
        if (!m) return next()

        const base = path.join(ROOT, m[1])
        const target = path.resolve(base, decodeURIComponent(m[2]))
        if (target !== base && !target.startsWith(base + path.sep)) return next() // 防目录穿越

        fs.stat(target, (err, st) => {
          if (err || !st.isFile()) return next()
          res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-cache')
          fs.createReadStream(target).pipe(res)
        })
      })
    },
  }
}

/**
 * 已从「纯离线单文件」改为「前后端一体」：
 *  - 构建产物输出到 server/public，由服务端托管
 *  - 不再内联成单文件 —— 走 HTTP 后按文件名 hash 缓存更划算，也不必每次重传 900KB
 *  - 打卡点数据改由 /api 提供，所以开发时把 /api 与 /photos 代理到服务端
 */
const SERVER_PORT = Number(process.env.UBR_SERVER_PORT || 8787)

export default defineConfig({
  base: '/',
  plugins: [react(), serveSharedAssets()],
  server: {
    // 让 dev server 有权读取仓库根目录下的瓦片与缩略图
    fs: { allow: [ROOT] },
    proxy: {
      '/api': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
      '/photos': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: '../server/public',  // 相对于 app/ 解析，所以要从上一级再进 server
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
})
