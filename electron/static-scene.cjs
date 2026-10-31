// Static 2D scene description. Does not execute wallpaper scripts or shaders.
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const { parseStaticMesh } = require('./static-mesh.cjs')

const IMAGE = /\.(png|jpe?g|webp|bmp|gif)$/i
const VIDEO = /\.(mp4|webm|mov|mkv|m4v|avi)$/i
const identity = [1, 0, 0, 1, 0, 0]
function value(input, fallback) {
  if (input == null) return fallback
  if (typeof input === 'object' && !Array.isArray(input)) return value(input.value, fallback)
  return input
}
function vector(input, fallback) {
  const raw = value(input, fallback)
  const parts = Array.isArray(raw) ? raw : String(raw).trim().split(/\s+/)
  return fallback.map((v, i) => Number.isFinite(Number(parts[i])) ? Number(parts[i]) : v)
}
function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.win32.isAbsolute(relative)) throw new Error('素材路径无效')
  const target = path.resolve(root, relative.replaceAll('\\', '/'))
  const rel = path.relative(root, target)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('素材路径超出壁纸目录')
  return target
}
async function walk(root) {
  const result = []
  async function visit(dir, depth) {
    if (depth > 20) throw new Error('壁纸目录层数过多')
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(target, depth + 1)
      else if (entry.isFile()) result.push(target)
      if (result.length > 30000) throw new Error('目录文件过多，请选择单张壁纸的文件夹')
    }
  }
  await visit(root, 0)
  return result
}
async function json(file) { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')) }
function color(input, fallback = [1, 1, 1]) { return vector(input, fallback).map(v => Math.max(0, Math.min(1, v))) }
function cssColor(input, fallback) { return `#${color(input, fallback).map(v => Math.round(v * 255).toString(16).padStart(2,'0')).join('')}` }

async function describe(root, register, { project = {}, preferredFile } = {}) {
  const files = await walk(root)
  const warnings = new Set()
  const imageFiles = files.filter(f => IMAGE.test(f) && !/^preview\./i.test(path.basename(f)))
  const videos = files.filter(f => VIDEO.test(f)).map(f => ({ name: path.basename(f), url: register(f) }))
  // Honour project.json's entry point before falling back to conventional scene.json.
  let sceneFile = preferredFile && files.find(f => f === safePath(root, preferredFile))
  if (!sceneFile || !/\.json$/i.test(sceneFile)) sceneFile = files.find(f => path.basename(f).toLowerCase() === 'scene.json')
  const layers = []
  const nodes = []
  let width = 0, height = 0, background = '#000000'
  let hasScene = false
  const metadata = new Map()
  const meshes = new Map()
  async function dimensions(file) {
    if (!metadata.has(file)) metadata.set(file, await sharp(file, { limitInputPixels: 100000000 }).metadata())
    return metadata.get(file)
  }
  const index = new Map(files.map(f => [path.relative(root, f).replaceAll('\\', '/').toLowerCase(), f]))
  function resolve(relative) {
    for (const base of sceneFile ? [path.dirname(sceneFile), root] : [root]) {
      const target = safePath(base, relative)
      const file = index.get(path.relative(root, target).replaceAll('\\', '/').toLowerCase())
      if (file) return file
    }
  }
  function textureFile(texture) {
    if (typeof texture !== 'string' || texture.startsWith('_rt_')) return null
    const base = texture.replace(/\.tex$/i, '')
    for (const candidate of [base, `materials/${base}`]) {
      if (IMAGE.test(candidate)) { const f = resolve(candidate); if (f) return f }
      for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']) {
        const f = resolve(candidate + ext)
        if (f) return f
      }
    }
    return null
  }
  if (sceneFile) {
    const scene = await json(sceneFile)
    if (!Array.isArray(scene.objects)) throw new Error('场景文件缺少图层列表')
    hasScene = true
    const projection = scene.general?.orthogonalprojection
    width = Number(projection?.width) || 0
    height = Number(projection?.height) || 0
    background = cssColor(scene.general?.clearcolor, [0, 0, 0])
    if (!width || !height || scene.general?.perspective === true) warnings.add('这是透视或未知尺寸场景，2D 合成无法完整还原相机和 3D 模型。')
    const objects = new Map(scene.objects.map((o, i) => [String(o.id ?? i), o]))
    const states = new Map()
    function state(id, chain = new Set()) {
      if (states.has(id)) return states.get(id)
      if (chain.has(id)) throw new Error('场景的父子图层存在循环')
      chain.add(id)
      const o = objects.get(id)
      const parent = o.parent != null && objects.has(String(o.parent)) ? state(String(o.parent), chain) : null
      const [x, y] = vector(o.origin, [0, 0, 0])
      const [sx, sy] = vector(o.scale, [1, 1, 1])
      const [rx, ry, angle] = vector(o.angles, [0, 0, 0])
      if (rx || ry) warnings.add('部分图层使用 3D 旋转，已按平面图层近似合成。')
      const c = Math.cos(angle), s = Math.sin(angle)
      const matrix = multiply(parent?.matrix ?? identity, [c*sx, s*sx, -s*sy, c*sy, x, y])
      const result = { matrix, ancestors: parent ? [...parent.ancestors, String(o.parent)] : [] }
      states.set(id, result)
      nodes.push({ id, name: String(o.name ?? id), visible: value(o.visible, true) !== false, parent: parent ? String(o.parent) : null })
      return result
    }
    for (const [id, o] of objects) {
      const transform = state(id)
      if (Object.values(o).some(v => v && typeof v === 'object' && ('script' in v || 'animation' in v))) warnings.add('脚本和动画使用文件中保存的静态值；日夜版本可在图层列表手动切换。')
      if ((o.particle && o.particle !== 'None') || o.text != null || o.shape || o.light) { warnings.add('粒子、文字和灯光未合成。'); continue }
      if (!o.image) continue
      try {
        const modelPath = resolve(o.image)
        if (!modelPath) throw new Error('缺少模型定义（可能是引擎内置素材）')
        if (!/\.json$/i.test(modelPath)) throw new Error('3D 模型不能直接合成')
        const model = await json(modelPath)
        const materialPath = resolve(model.material)
        if (!materialPath) throw new Error('缺少材质定义')
        const material = await json(materialPath)
        const pass = material.passes?.[0] ?? material
        const overrides = o.instance?.textures
        const texture = value(overrides?.[0] ?? overrides?.['0'] ?? pass.textures?.[0], null)
        const file = textureFile(texture)
        if (!file) throw new Error('没有可用的静态纹理')
        const meta = await dimensions(file)
        const size = vector(o.size, [Number(model.width) || meta.width, Number(model.height) || meta.height])
          .map((v, i) => v > 0 ? v : [meta.width, meta.height][i])
        const [a,b,c,d,e,f] = transform.matrix
        // Wallpaper Engine uses bottom-left coordinates and radians. Canvas uses top-left.
        const matrix = [a, -b, -c, d, e, -f]
        const blendNames = { additive: 'lighter', translucent: 'source-over', normal: 'source-over', opaque: 'source-over' }
        let blend = blendNames[pass.blending ?? 'translucent']
        if (!blend) { blend = 'source-over'; warnings.add('部分材质混合方式使用普通叠加代替。') }
        if (Number(value(o.colorBlendMode, 0)) !== 0) warnings.add('部分图层使用特殊颜色混合，当前以普通叠加近似。')
        const notes = []
        const opacityMasks = []
        let unsupportedEffects = false
        for (const effect of o.effects ?? []) {
          if (value(effect.visible, true) === false) continue
          // Only interpret the known opacity effect; never guess masks from filenames.
          const builtin = String(effect.file ?? '').replaceAll('\\','/').toLowerCase() === 'effects/opacity/effect.json'
          if (!builtin) { unsupportedEffects = true; continue }
          const settings = effect.passes?.[0] ?? {}
          const alphaValue = Number(value(settings.constantshadervalues?.alpha, 1))
          const alpha = Number.isFinite(alphaValue) ? Math.max(0,Math.min(1,alphaValue)) : 1
          const reference = value(settings.textures?.[1], null)
          const usesMask = Number(value(settings.combos?.MASK, 1)) !== 0
          const maskFile = usesMask && reference ? textureFile(reference) : null
          if (usesMask && reference && !maskFile) warnings.add(`「${o.name ?? id}」缺少透明度遮罩，未猜测替代图片。`)
          opacityMasks.push({ url:maskFile ? register(maskFile) : null, alpha })
        }
        if (opacityMasks.some(mask=>mask.url)) notes.push('已应用壁纸自带的轮廓遮罩')
        let mesh
        if (model.puppet) {
          const meshFile = resolve(model.puppet)
          if (!meshFile) throw new Error('缺少骨骼模型，无法确定五官等素材的准确位置')
          if (!meshes.has(meshFile)) meshes.set(meshFile,parseStaticMesh(await fs.readFile(meshFile)))
          mesh=meshes.get(meshFile)
          notes.push('使用模型保存的静态形状，不播放骨骼动画')
          warnings.add('骨骼图层使用模型保存的静态形状，不播放动画。')
        }
        if (unsupportedEffects || material.passes?.length > 1) warnings.add('部分动态特效和多通道着色器未还原，合成基础图像及透明度遮罩。')
        layers.push({ id, name: String(o.name ?? id), url: register(file), width: size[0], height: size[1],
          sourceWidth: meta.width, sourceHeight: meta.height, matrix, ancestors: transform.ancestors,
          opacity: Math.max(0, Math.min(1, Number(value(o.alpha, 1)))), color: color(o.color),
          brightness: Math.max(0, Number(value(o.brightness, 1))), blend, notes, mesh, opacityMasks,
          alignment: o.alignment ?? o.horizontalalign ?? 'center' })
      } catch (error) { warnings.add(`未合成「${o.name ?? id}」：${error.message}`) }
    }
  } else if (imageFiles.length) {
    warnings.add('没有场景布局信息。已按原图尺寸居中，默认只勾选最大的一张；请选择同一版本的图层并调整顺序。')
    const images = []
    for (const file of imageFiles) {
      try { const meta = await dimensions(file); images.push({ file, width: meta.width, height: meta.height }) }
      catch { warnings.add(`无法读取图片：${path.basename(file)}`) }
    }
    images.sort((a, b) => b.width*b.height - a.width*a.height || a.file.localeCompare(b.file))
    width = images[0]?.width ?? 0; height = images[0]?.height ?? 0
    for (const [i, image] of images.entries()) {
      const id = String(i)
      nodes.push({ id, name: path.basename(image.file), visible: i === 0, parent: null })
      layers.push({ id, name: path.basename(image.file), url: register(image.file), width: image.width, height: image.height,
        sourceWidth: image.width, sourceHeight: image.height, matrix: [1,0,0,1,width/2,-height/2], ancestors: [],
        opacity: 1, color: [1,1,1], brightness: 1, blend: 'source-over', notes: [], alignment: 'center' })
    }
  }
  if ((!width || !height) && layers.length) {
    width = Math.max(...layers.map(l => l.sourceWidth)); height = Math.max(...layers.map(l => l.sourceHeight))
  }
  return { title: project.title || path.basename(root), width, height, background, layers, nodes, videos,
    hasScene, warnings: [...warnings] }
}

module.exports = { describe, safePath, walk, value, vector, multiply, IMAGE, VIDEO }
