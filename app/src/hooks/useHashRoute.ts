import { useCallback, useEffect, useState } from 'react'

/**
 * 极简 hash 路由。
 *
 * 用 hash 而不是 history API，是为了保住「双击 index.html 就能用」这个特性：
 * file:// 下 pushState 会因同源策略受限，而 hash 变化在本地文件里完全正常。
 * 因此地址形如 #/admin，而不是 /admin —— 后者需要 HTTP 服务器部署。
 */
export type Route = 'map' | 'admin'

export function parseHash(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split(/[?&]/)[0].replace(/\/+$/, '').toLowerCase()
  return p === 'admin' ? 'admin' : 'map'
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((r: Route) => {
    const next = r === 'admin' ? '#/admin' : '#/'
    if (window.location.hash !== next) window.location.hash = next
    else setRoute(r)
  }, [])

  return [route, navigate]
}
