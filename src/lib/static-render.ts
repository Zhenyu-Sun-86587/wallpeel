import { prepareLayer } from './static-layer'

export interface StillLayer {
  id: string
  name: string
  url: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  matrix: [number, number, number, number, number, number]
  ancestors: string[]
  opacity: number
  color: [number, number, number]
  brightness: number
  blend: GlobalCompositeOperation
  alignment: string
  notes: string[]
  mesh?: { positions: number[]; uvs: number[]; indices: number[] }
  opacityMasks?: { url: string | null; alpha: number }[]
}
export interface StillDocument {
  id: string
  title: string
  width: number
  height: number
  background: string
  hasScene: boolean
  warnings: string[]
  layers: StillLayer[]
  nodes: { id: string; name: string; visible: boolean; parent: string | null }[]
  videos: { name: string; url: string }[]
}
export interface LayerEdit { visible: boolean; x: number; y: number; scale: number; rotation: number; opacity: number; useMasks: boolean; defringe: number }
export type Edits = Record<string, LayerEdit>
export interface StaticAPI {
  choose: (kind: 'file' | 'folder') => Promise<string | null>
  prepare: (path: string) => Promise<StillDocument>
  output: (id: string, defaultPath: string) => Promise<string | null>
  save: (payload: { id: string; data: ArrayBuffer; format: 'png' | 'jpg'; name: string }) => Promise<{path: string; width: number; height: number}>
  release: (id: string) => Promise<void>
}
export function defaultEdits(doc: StillDocument): Edits {
  return Object.fromEntries(doc.nodes.map(n => [n.id, { visible: n.visible, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, useMasks: true, defringe: 0 }]))
}
export function isVisible(layer: StillLayer, edits: Edits) {
  return edits[layer.id]?.visible && layer.ancestors.every(id => edits[id]?.visible !== false)
}
export function validateSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64000000) {
    throw new Error('分辨率需为正整数，最长边不超过 16384，总像素不超过 6400 万')
  }
}
export function makeImageCache() {
  const cache = new Map<string, Promise<HTMLImageElement>>()
  return (url: string) => {
    if (!cache.has(url)) cache.set(url, new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => { cache.delete(url); reject(new Error('图片加载失败，请重新打开壁纸')) }
      image.src = url
    }))
    return cache.get(url)!
  }
}
export async function drawScene(canvas: HTMLCanvasElement, doc: StillDocument, layers: StillLayer[], edits: Edits,
  loadImage: ReturnType<typeof makeImageCache>, width: number, height: number, background: string, transparent: boolean) {
  validateSize(width, height)
  if (!doc.width || !doc.height) throw new Error('无法确定画布尺寸')
  const visible = layers.filter(l => isVisible(l, edits))
  if (!visible.length) throw new Error('请至少勾选一个可见图层')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  if (!transparent) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height) }
  ctx.scale(width / doc.width, height / doc.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  for (const layer of visible) {
    const image = await loadImage(layer.url)
    const edit = edits[layer.id]
    let source: CanvasImageSource = await prepareLayer(image,layer,edit,loadImage)
    // Multiply RGB while preserving alpha, including partially transparent pixels.
    if (layer.color.some(c => c !== 1) || layer.brightness !== 1) {
      const tinted = document.createElement('canvas')
      // A preview only needs preview-sized pixels; final exports retain source resolution.
      const ratio = Math.min(1, Math.max(width / doc.width, height / doc.height))
      tinted.width = Math.max(1, Math.round((layer.mesh ? layer.width : image.naturalWidth) * ratio))
      tinted.height = Math.max(1, Math.round((layer.mesh ? layer.height : image.naturalHeight) * ratio))
      const tctx = tinted.getContext('2d', { willReadFrequently: true })!
      tctx.drawImage(source, 0, 0, tinted.width, tinted.height)
      const pixels = tctx.getImageData(0, 0, tinted.width, tinted.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) pixels.data[i+c] *= layer.color[c] * layer.brightness
      }
      tctx.putImageData(pixels, 0, 0)
      source = tinted
    }
    ctx.save()
    ctx.globalAlpha = layer.opacity * edit.opacity
    ctx.globalCompositeOperation = layer.blend
    const [a,b,c,d,e,f] = layer.matrix
    ctx.translate(edit.x, edit.y)
    ctx.transform(a,b,c,d,e,doc.height+f)
    ctx.rotate(edit.rotation * Math.PI / 180)
    ctx.scale(edit.scale, edit.scale)
    const left = layer.alignment.includes('left') ? 0 : layer.alignment.includes('right') ? -layer.width : -layer.width/2
    const top = layer.alignment.includes('top') ? 0 : layer.alignment.includes('bottom') ? -layer.height : -layer.height/2
    ctx.drawImage(source, left, top, layer.width, layer.height)
    ctx.restore()
  }
}
export function encodeCanvas(canvas: HTMLCanvasElement, format: 'png' | 'jpg', quality: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) { reject(new Error('图片编码失败，可能是分辨率过大')); return }
      try { resolve(await blob.arrayBuffer()) } catch (error) { reject(error) }
    }, format === 'jpg' ? 'image/jpeg' : 'image/png', quality / 100)
  })
}
export async function seekFrame(video: HTMLVideoElement, time: number) {
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(video.duration) || time >= video.duration) throw new Error('选帧时间超出视频长度')
  video.pause()
  if (video.readyState >= 2 && Math.abs(video.currentTime-time) < 0.00001 && !video.seeking) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked',done); video.removeEventListener('error',fail) }
    const done = () => { cleanup(); resolve() }
    const fail = () => { cleanup(); reject(new Error('视频解码失败，请转换成 MP4(H.264) 或 WebM 后重试')) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('视频定位超时')) }, 20000)
    video.addEventListener('seeked',done,{once:true}); video.addEventListener('error',fail,{once:true})
    video.currentTime = time
  })
}
export function timeLabel(time: number) {
  return `${Math.floor(time/60).toString().padStart(2,'0')}:${(time%60).toFixed(3).padStart(6,'0')}`
}
