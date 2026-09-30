/**
 * 开发模式：同时启动服务端与前端 dev server。
 *
 * 前端（Vite）把 /api 与 /photos 代理到服务端，所以浏览器里只需要访问 Vite 的端口，
 * 改前端代码有热更新，改服务端代码由 node --watch 自动重启。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_PORT = process.env.UBR_SERVER_PORT || '8787'

const procs = []

function run(label, cmd, args, cwd, color) {
  const p = spawn(cmd, args, {
    cwd,
    env: { ...process.env, PORT: SERVER_PORT, UBR_SERVER_PORT: SERVER_PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tag = `\x1b[${color}m[${label}]\x1b[0m`
  const forward = (stream) => {
    stream.setEncoding('utf8')
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) console.log(`${tag} ${line}`)
    })
  }
  forward(p.stdout)
  forward(p.stderr)
  p.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`${tag} 进程退出（code=${code}），正在停止其它进程`)
      shutdown()
    }
  })
  procs.push(p)
  return p
}

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of procs) {
    try { p.kill('SIGTERM') } catch { /* 已退出 */ }
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log(`\n  服务端端口 ${SERVER_PORT}；前端 dev server 的 /api 与 /photos 会代理到它\n`)

run('server', 'node', ['--watch', 'index.mjs'], path.join(ROOT, 'server'), '36')
run('app', 'npm', ['run', 'dev'], path.join(ROOT, 'app'), '35')