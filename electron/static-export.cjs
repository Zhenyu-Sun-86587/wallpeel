const fs = require('node:fs/promises')
const nativeFs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const sharp = require('sharp')
const { describe, safePath, walk, IMAGE, VIDEO } = require('./static-scene.cjs')

// MPKG uses a length-prefixed version, then a table of name/index/size entries.
async function unpackMpkg(file, root) {
  const buffer = await fs.readFile(file)
  let offset = 0
  function u32() { if (offset + 4 > buffer.length) throw new Error('MPKG 文件不完整'); const n = buffer.readUInt32LE(offset); offset += 4; return n }
  function string() { const n = u32(); if (n > 32768 || offset + n > buffer.length) throw new Error('MPKG 文件头无效'); const s = buffer.toString('utf8', offset, offset + n); offset += n; return s }
  const version = string()
  if (!/^(PKGM|MPKG)\d{4}$/.test(version)) throw new Error('不支持的 MPKG 版本')
  const count = u32()
  if (count > 30000) throw new Error('MPKG 文件数过多')
  const entries = []
  for (let i = 0; i < count; i++) { const name = string(); u32(); entries.push({ target: safePath(root, name), size: u32() }) }
  for (const entry of entries) {
    if (offset + entry.size > buffer.length) throw new Error('MPKG 数据不完整')
    // Audio is not needed for a still image. Keep directories and scene metadata intact.
    if (/\.(pkg|json|tex|mdl)$/i.test(entry.target) || IMAGE.test(entry.target) || VIDEO.test(entry.target)) {
      await fs.mkdir(path.dirname(entry.target), { recursive: true })
      await fs.writeFile(entry.target, buffer.subarray(offset, offset + entry.size), { flag: 'wx' })
    }
    offset += entry.size
  }
}
async function extractPkg(file, root, repkg) {
  await fs.mkdir(root, { recursive: true })
  await validatePkg(file, root)
  await new Promise((resolve, reject) => {
    const child = spawn(repkg, ['extract', '-e', 'json,tex,mdl,png,jpg,jpeg,webp,mp4,webm,mov,mkv,m4v', '-o', root, file], { windowsHide: true })
    let log = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('解包超时，请选择较小的壁纸包')) }, 300000)
    const collect = data => { log = (log + data.toString()).slice(-2000) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`解包失败：${log}`)) })
  })
}

// Validate the archive table before invoking RePKG, including unselected file paths.
async function validatePkg(file, root) {
  const handle = await fs.open(file, 'r')
  try {
    let offset = 0
    async function read(size) {
      const data = Buffer.alloc(size)
      const {bytesRead} = await handle.read(data,0,size,offset)
      if (bytesRead !== size) throw new Error('PKG 文件不完整')
      offset += size; return data
    }
    async function u32() { return (await read(4)).readUInt32LE() }
    async function string() { const size = await u32(); if (size > 32768) throw new Error('PKG 文件头无效'); return (await read(size)).toString('utf8') }
    if (!/^PKGV\d{4}$/.test(await string())) throw new Error('不支持的 PKG 版本')
    const count = await u32()
    if (count > 30000) throw new Error('PKG 文件数过多')
    let dataEnd = 0
    for (let i=0;i<count;i++) { safePath(root,await string()); const start=await u32(); const size=await u32(); dataEnd=Math.max(dataEnd,start+size) }
    if (offset + dataEnd > (await handle.stat()).size) throw new Error('PKG 素材数据不完整')
  } finally { await handle.close() }
}

function installStaticExport({ app, ipcMain, protocol, dialog, BrowserWindow }) {
  const sessions = new Map()
  function session(id, sender) {
    const item = sessions.get(id)
    if (!item || item.owner !== sender.id) throw new Error('导出会话已关闭，请重新打开')
    return item
  }
  async function release(id) {
    const item = sessions.get(id)
    if (!item) return
    sessions.delete(id)
    await fs.rm(item.temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {})
  }
  app.whenReady().then(() => {
    protocol.handle('wallpeel-media', async request => {
      try {
        const url = new URL(request.url)
        const item = sessions.get(url.hostname)
        const file = item?.assets.get(url.pathname.slice(1))
        if (!file) return new Response('Not found', { status: 404 })
        const size = (await fs.stat(file)).size
        const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.bmp':'image/bmp', '.mp4':'video/mp4', '.m4v':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime', '.mkv':'video/x-matroska', '.avi':'video/x-msvideo' }[path.extname(file).toLowerCase()]
        const headers = { 'Content-Type': mime || 'application/octet-stream', 'Accept-Ranges':'bytes', 'Access-Control-Allow-Origin':'*' }
        let start = 0, end = size - 1, status = 200
        const range = request.headers.get('range')
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)
          if (!match || (!match[1] && !match[2])) return new Response(null, { status:416, headers:{ 'Content-Range':`bytes */${size}` } })
          start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
          end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
          if (start > end || start >= size) return new Response(null, { status:416, headers:{ 'Content-Range':`bytes */${size}` } })
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`
        }
        headers['Content-Length'] = String(Math.max(0, end-start+1))
        if (request.method === 'HEAD' || !size) return new Response(null, { status, headers })
        const stream = nativeFs.createReadStream(file, { start, end })
        return new Response(Readable.toWeb(stream), { status, headers })
      } catch { return new Response('Cannot read media', { status:500 }) }
    })
  })
  ipcMain.handle('static:choose', async (event, kind) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: kind === 'folder' ? '选择单张壁纸或散图文件夹' : '选择壁纸包或视频',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      ...(kind === 'folder' ? {} : { filters:[{ name:'壁纸包 / 视频 / 场景', extensions:['pkg','mpkg','mp4','webm','mov','mkv','m4v','avi','json'] }] }),
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('static:prepare', async (event, input) => {
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('请选择壁纸路径')
    const stat = await fs.stat(input)
    const id = randomUUID()
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wallpeel-still-'))
    const item = { temp, owner:event.sender.id, assets:new Map(), output:null, saved:[] }
    sessions.set(id, item)
    const register = file => { const asset = randomUUID(); item.assets.set(asset, file); return `wallpeel-media://${id}/${asset}` }
    try {
      let root = stat.isDirectory() ? input : path.dirname(input)
      let project = { title:stat.isDirectory() ? path.basename(input) : path.parse(input).name }
      try { project = JSON.parse((await fs.readFile(path.join(root,'project.json'),'utf8')).replace(/^\uFEFF/,'')) } catch { /* Loose media need no project. */ }
      let source = input
      if (stat.isDirectory() || /\.json$/i.test(input)) {
        const top = await fs.readdir(root)
        // Prefer an unpacked scene, otherwise unpack into a private temporary directory.
        if (!top.some(f => f.toLowerCase() === 'scene.json')) {
          const pkg = top.find(f => /\.pkg$/i.test(f)) ?? top.find(f => /\.mpkg$/i.test(f))
          if (pkg) source = path.join(root,pkg)
        }
      }
      const repkg = path.join(app.getAppPath(), 'tools', 'RePKG.exe')
      if (/\.mpkg$/i.test(source)) {
        root = path.join(temp,'mpkg'); await fs.mkdir(root)
        await unpackMpkg(source,root)
        const pkg = (await walk(root)).find(f => /\.pkg$/i.test(f))
        if (pkg) await extractPkg(pkg, path.dirname(pkg), repkg)
      } else if (/\.pkg$/i.test(source)) {
        root = path.join(temp,'scene'); await extractPkg(source,root,repkg)
      }
      let description
      if (VIDEO.test(source)) description = { title:path.parse(source).name, width:0, height:0, background:'#000000', layers:[], nodes:[], hasScene:false, warnings:[], videos:[{name:path.basename(source),url:register(source)}] }
      else description = await describe(root, register, { project, preferredFile: /\.json$/i.test(input) && path.basename(input).toLowerCase() !== 'project.json' ? path.relative(root,input) : project.file })
      if (!description.layers.length && !description.videos.length) throw new Error('没有可导出的图片或视频；请确认选择的是单张壁纸目录')
      event.sender.once('destroyed', () => { void release(id) })
      return { ...description, id }
    } catch (error) { await release(id); throw error }
  })
  ipcMain.handle('static:output', async (event, id, defaultPath) => {
    const item = session(id,event.sender)
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title:'选择静态壁纸保存位置', defaultPath:defaultPath || app.getPath('pictures'), properties:['openDirectory','createDirectory'],
    })
    if (result.canceled) return null
    item.output = result.filePaths[0]
    return item.output
  })
  ipcMain.handle('static:save', async (event, { id, data, format, name }) => {
    const item = session(id,event.sender)
    if (!item.output) throw new Error('请先选择保存位置')
    if (!['png','jpg'].includes(format)) throw new Error('请选择 PNG 或 JPG')
    const buffer = Buffer.from(data)
    if (!buffer.length || buffer.length > 256*1024*1024) throw new Error('导出图片过大或为空')
    const meta = await sharp(buffer, {limitInputPixels:64000000}).metadata()
    if (meta.format !== (format === 'jpg' ? 'jpeg' : 'png')) throw new Error('图片编码与文件格式不一致')
    const stem = String(name || 'wallpaper').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,100) || 'wallpaper'
    const target = path.join(item.output,`${stem}-${Date.now()}-${randomUUID().slice(0,8)}.${format}`)
    await fs.writeFile(target,buffer,{flag:'wx'})
    item.saved.push(target)
    return { path:target, width:meta.width, height:meta.height }
  })
  ipcMain.handle('static:release', async (event, id) => { session(id,event.sender); await release(id) })
  app.on('will-quit', () => {
    // Only remove temporary directories created by this module, never user inputs.
    for (const item of sessions.values()) {
      try { nativeFs.rmSync(item.temp,{recursive:true,force:true,maxRetries:2}) } catch { /* OS may still hold a media handle. */ }
    }
  })
}
module.exports = { installStaticExport, unpackMpkg, validatePkg }
