import { useEffect, useRef } from 'react'

interface Props {
  onClose: () => void
  /** 拖动超过该距离（px）则关闭 */
  threshold?: number
  /** 被拖动并位移的元素；默认取抽屉内容 */
  targetSelector?: string
  disabled?: boolean
}

/**
 * iOS 风格的抓取条：抽屉顶部一个灰色小横条，向下拖拽即可关闭。
 *
 * 为什么需要它：抽屉若用遮罩（哪怕全透明）承接"点空白关闭"，那层遮罩会拦截
 * 全部地图点击，抽屉开着时就没法点其他点位切换详情。iOS 的做法是去掉遮罩，
 * 改用一个可拖拽的把手来关闭 —— 于是地图始终可交互，关闭也仍有明确入口。
 *
 * 拖动期间直接改 DOM 的 transform，不走 React state：指针事件频率很高，
 * 每次 setState 都会重渲染，跟手感会明显变差。释放后再把样式交还给组件库。
 */
export function SheetGrabber({
  onClose,
  threshold = 90,
  targetSelector = '.mantine-Drawer-content',
  disabled = false,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const bar = barRef.current
    if (!bar || disabled) return

    const content = () => document.querySelector(targetSelector) as HTMLElement | null

    let dragging = false
    let startY = 0
    let offset = 0
    let released = false

    const reset = (el: HTMLElement) => {
      el.style.transform = ''
      el.style.transition = ''
    }

    const onDown = (e: PointerEvent) => {
      const el = content()
      if (!el) return
      dragging = true
      released = false
      startY = e.clientY
      offset = 0
      el.style.transition = 'none'
      // 拖动期间禁用动画过渡，否则每帧都会被过渡拖后腿
      try {
        bar.setPointerCapture(e.pointerId)
      } catch {
        /* 某些环境不支持指针捕获，退化为普通事件流 */
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const el = content()
      if (!el) return
      const dy = e.clientY - startY
      // 只允许向下拖；向上给阻尼，避免拖出屏幕外产生大段空白
      offset = dy > 0 ? dy : Math.max(-24, dy * 0.25)
      el.style.transform = `translateY(${Math.round(offset)}px)`
    }

    const onUp = () => {
      if (!dragging) return
      dragging = false
      const el = content()
      if (!el) return
      released = true

      if (offset > threshold) {
        // 自己先滑出屏幕，再把手势结果交给上层触发关闭。
        //
        // 关键：这里**不能**在关闭前调 reset() 清空 transform。
        // 清空会让元素立刻回到 CSS 原位（translateY(0) = 完全展开），
        // 浏览器会渲染出这样一帧，然后才播收起动画 —— 表现就是
        // "快速拖动关闭时，抽屉先完全展开闪一下再关掉"。
        // 实测采样：y 从 687 直接跳回 0，隔一帧才消失。
        //
        // 直接把 transform 留在屏幕外即可：关闭流程走完后 Mantine 会卸载内容节点
        //（默认 keepMounted: false），下次打开是新节点，残留的内联样式自然不存在。
        el.style.transition = 'transform .2s cubic-bezier(.32,.9,.3,1)'
        el.style.transform = 'translateY(110%)'
        window.setTimeout(() => closeRef.current(), 200)
      } else {
        el.style.transition = 'transform .26s cubic-bezier(.32,1.18,.4,1)'
        el.style.transform = 'translateY(0)'
        window.setTimeout(() => reset(el), 280)
      }
    }

    const onCancel = () => {
      if (!dragging) return
      dragging = false
      const el = content()
      if (el) {
        el.style.transition = 'transform .26s cubic-bezier(.32,1.18,.4,1)'
        el.style.transform = 'translateY(0)'
        window.setTimeout(() => reset(el), 280)
      }
    }

    bar.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      bar.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!released) {
        const el = content()
        if (el) reset(el)
      }
    }
  }, [disabled, targetSelector, threshold])

  return (
    <div className="ubr-grabber" ref={barRef} role="separator" aria-label="向下拖动可关闭">
      <span />
    </div>
  )
}