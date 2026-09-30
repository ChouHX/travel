/**
 * 客户端图片压缩：等比缩放到最长边上限，再编码为 WebP。
 *
 * 直接上传原图会有几个问题：手机照片动辄 4–8MB、分辨率 4000px 以上，
 * 存进 IndexedDB 既占空间、读取也慢，而地图标注场景只需要看清环境与机位。
 * 因此统一压到长边 1600px / WebP q0.82，通常可压到原体积的 5%–10%。
 */
export interface CompressedImage {
  blob: Blob
  width: number
  height: number
  bytes: number
  originalBytes: number
  /** 实际编码格式；Safari 等不支持 WebP 编码时会回退到 jpeg */
  type: string
}

export interface CompressOptions {
  maxEdge?: number
  quality?: number
}

/** 探测浏览器是否支持 canvas 编码 WebP */
let webpSupported: boolean | null = null

async function supportsWebp(): Promise<boolean> {
  if (webpSupported !== null) return webpSupported
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.8))
    webpSupported = !!blob && blob.type === 'image/webp'
  } catch {
    webpSupported = false
  }
  return webpSupported
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = url
    })
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export async function compressToWebp(file: Blob, opts: CompressOptions = {}): Promise<CompressedImage> {
  const { maxEdge = 1600, quality = 0.82 } = opts

  const src = await loadBitmap(file)
  const sw = 'width' in src ? src.width : 0
  const sh = 'height' in src ? src.height : 0
  if (!sw || !sh) throw new Error('图片尺寸异常')

  const scale = Math.min(1, maxEdge / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h)
  if ('close' in src && typeof src.close === 'function') src.close()

  const wantWebp = await supportsWebp()
  const type = wantWebp ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality))
  if (!blob) throw new Error('图片编码失败')

  return {
    blob,
    width: w,
    height: h,
    bytes: blob.size,
    originalBytes: file.size,
    type: blob.type,
  }
}

export const fmtBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

/** Blob → base64（不含 data: 前缀），用于导出 JSON */
export function blobToBase64(blob: Blob): Promise<string> {
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

/** base64 → Blob，用于导入 JSON */
export function base64ToBlob(b64: string, type = 'image/webp'): Blob {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type })
}
