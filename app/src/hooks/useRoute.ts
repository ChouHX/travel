import { useCallback, useEffect, useState } from 'react'

export type Route = 'map' | 'admin'

/** 使用路径路由；服务端将 /admin 的直接访问和刷新交给同一前端入口。 */
export function parsePath(path: string): Route {
  return path.replace(/\/+$/, '').toLowerCase() === '/admin' ? 'admin' : 'map'
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname))

  useEffect(() => {
    const onChange = () => setRoute(parsePath(window.location.pathname))
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  const navigate = useCallback((r: Route) => {
    const next = r === 'admin' ? '/admin' : '/'
    if (window.location.pathname !== next || window.location.hash || window.location.search) {
      window.history.pushState(null, '', next)
    }
    setRoute(r)
  }, [])

  return [route, navigate]
}
