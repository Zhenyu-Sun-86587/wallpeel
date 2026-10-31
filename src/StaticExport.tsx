import { useEffect, useRef, useState } from 'react'
import { Camera, FolderOpen, ImageIcon, Loader2, X, ArrowUp, ArrowDown } from 'lucide-react'
import { defaultEdits, drawScene, encodeCanvas, isVisible, makeImageCache, seekFrame, timeLabel, validateSize } from './lib/static-render'
import type { Edits, StillDocument, StillLayer, LayerEdit } from './lib/static-render'
import './StaticExport.css'

interface Props { inputPath?: string; outputDir: string; dark: boolean; onClose: () => void }
const message = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e)

export default function StaticExport({ inputPath, outputDir, dark, onClose }: Props) {
  const [doc, setDoc] = useState<StillDocument | null>(null)
  const [layers, setLayers] = useState<StillLayer[]>([])
  const [edits, setEdits] = useState<Edits>({})
  const [selected, setSelected] = useState('')
  const [mode, setMode] = useState<'scene' | 'video'>('scene')
  const [videoIndex, setVideoIndex] = useState(0)
  const [videoInfo, setVideoInfo] = useState({ width:0, height:0, duration:0 })
  const [current, setCurrent] = useState(0)
  const [frames, setFrames] = useState<number[]>([])
  const [manualTime, setManualTime] = useState('')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [quality, setQuality] = useState(98)
  const [background, setBackground] = useState('#000000')
  const [transparent, setTransparent] = useState(false)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [saved, setSaved] = useState<string[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const cache = useRef(makeImageCache())
  const activeSession = useRef<string | null>(null)
  const operation = useRef(false)
  const mounted = useRef(true)
  const initialPath = useRef(inputPath)
  const nativeSize = mode === 'video' ? videoInfo : doc

  async function open(input: string) {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(''); setSaved([]); setStatus('正在读取壁纸，原始文件会保留…')
    // Clear media elements before releasing temporary files on Windows.
    setDoc(null); setLayers([]); cache.current = makeImageCache()
    try {
      if (activeSession.current) { await window.wallpeel.staticExport.release(activeSession.current); activeSession.current = null }
      const result = await window.wallpeel.staticExport.prepare(input)
      if (!mounted.current) { await window.wallpeel.staticExport.release(result.id); return }
      activeSession.current = result.id
      setDoc(result); setLayers(result.layers); setEdits(defaultEdits(result)); setSelected(result.layers[0]?.id || '')
      setMode(result.layers.length ? 'scene' : 'video'); setVideoIndex(0); setFrames([]); setVideoInfo({width:0,height:0,duration:0}); setCurrent(0)
      setBackground(result.background); setTransparent(false); setWidth(result.width); setHeight(result.height)
      setStatus('')
    } catch (e) { if (mounted.current) { setError(message(e)); setStatus('') } }
    finally { operation.current = false; if (mounted.current) setBusy(false) }
  }
  useEffect(() => {
    mounted.current = true
    // Defer to avoid starting a duplicate preparation during React's development effect replay.
    const timer = setTimeout(() => { if (initialPath.current) void open(initialPath.current) }, 0)
    return () => {
      mounted.current = false; clearTimeout(timer)
      if (activeSession.current) { void window.wallpeel.staticExport.release(activeSession.current).catch(() => {}); activeSession.current = null }
    }
  }, [])

  useEffect(() => {
    if (!doc || mode !== 'scene') return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const ratio = Math.min(1, 1000/doc.width, 700/doc.height)
        // Draw into a separate canvas so a stale async render can never overwrite a newer preview.
        const next = document.createElement('canvas')
        await drawScene(next,doc,layers,edits,cache.current,Math.max(1,Math.round(doc.width*ratio)),Math.max(1,Math.round(doc.height*ratio)),background,transparent && format === 'png')
        if (!cancelled && canvas.current) {
          canvas.current.width = next.width; canvas.current.height = next.height
          canvas.current.getContext('2d')!.drawImage(next,0,0); setPreviewError('')
        }
      } catch (e) {
        if (!cancelled) { canvas.current?.getContext('2d')?.clearRect(0,0,canvas.current.width,canvas.current.height); setPreviewError(message(e)) }
      }
    }, 100)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [doc,layers,edits,background,transparent,format,mode])

  function edit(id: string, patch: Partial<LayerEdit>) { setEdits(prev => ({...prev,[id]:{...prev[id],...patch}})) }
  function reorder(id: string, delta: number) {
    setLayers(prev => { const next = [...prev]; const i = next.findIndex(l=>l.id===id); const j=i+delta; if (j>=0 && j<next.length) [next[i],next[j]]=[next[j],next[i]]; return next })
  }
  function switchMode(next: 'scene' | 'video') {
    setMode(next); setError('')
    const size = next === 'scene' ? doc : videoInfo
    setWidth(size?.width || 0); setHeight(size?.height || 0)
  }
  function addFrame(time: number) {
    if (!Number.isFinite(time) || time < 0 || time >= videoInfo.duration) { setError('请输入视频时长范围内的秒数'); return }
    if (frames.length >= 24) { setError('一次最多选择 24 帧'); return }
    setFrames(prev => [...new Set([...prev,Math.floor(time*1000)/1000])].sort((a,b)=>a-b)); setError('')
  }
  async function choose(kind: 'file' | 'folder') {
    try { const input = await window.wallpeel.staticExport.choose(kind); if (input) await open(input) } catch(e) { setError(message(e)) }
  }
  async function exportImages() {
    if (!doc || operation.current) return
    operation.current = true; setBusy(true); setError(''); setSaved([])
    try {
      validateSize(width,height)
      if (mode === 'scene' && !layers.some(l=>isVisible(l,edits))) throw new Error('请先勾选要合成的图层')
      if (mode === 'video' && (!videoInfo.duration || !video.current || !frames.length)) throw new Error('请先选择要导出的帧')
      video.current?.pause()
      const target = await window.wallpeel.staticExport.output(doc.id,outputDir)
      if (!target) return
      const output = document.createElement('canvas')
      const save = async (name: string) => {
        const data = await encodeCanvas(output,format,quality)
        const result = await window.wallpeel.staticExport.save({id:doc.id,data,format,name})
        setSaved(prev=>[...prev,result.path])
      }
      if (mode === 'scene') {
        setStatus('正在按所选分辨率合成整图…')
        await drawScene(output,doc,layers,edits,cache.current,width,height,background,transparent && format === 'png')
        await save(doc.title)
      } else {
        const player = video.current!
        const previousTime = player.currentTime
        for (const [index,time] of frames.entries()) {
          setStatus(`正在保存第 ${index+1} / ${frames.length} 帧（${timeLabel(time)}）…`)
          await seekFrame(player,time)
          output.width=width; output.height=height
          const ctx=output.getContext('2d')!
          ctx.imageSmoothingQuality='high'; ctx.drawImage(player,0,0,width,height)
          await save(`${doc.title}-${doc.videos[videoIndex].name.replace(/\.[^.]+$/,'')}-${time.toFixed(3)}s`)
        }
        await seekFrame(player,Math.min(previousTime,Math.max(0,player.duration-0.05)))
      }
      output.width=0; output.height=0
      setStatus(`已保存到 ${target}`)
    } catch(e) { setError(message(e)); setStatus('导出未完成；下方已保存的图片可以继续使用。') }
    finally { operation.current=false; setBusy(false) }
  }
  const selectedLayer=layers.find(l=>l.id===selected)
  const selectedEdit=edits[selected]
  return <div className={`still-overlay ${dark?'still-dark':''}`} role="dialog" aria-modal="true" aria-labelledby="still-title">
    <section className="still-window">
      <header className="still-header">
        <div><h2 id="still-title"><ImageIcon size={20}/> 导出静态壁纸</h2><p>{doc?.title || '整张图片合成 · 视频选帧'}</p></div>
        <button className="still-icon" aria-label="关闭静态导出" disabled={busy} onClick={onClose}><X size={20}/></button>
      </header>
      <div className="still-tools">
        <button disabled={busy} onClick={()=>void choose('folder')}><FolderOpen size={15}/> 打开壁纸 / 散图文件夹</button>
        <button disabled={busy} onClick={()=>void choose('file')}>打开 PKG / MPKG / 视频</button>
        {busy && <span><Loader2 size={15} className="animate-spin"/> 处理中…</span>}
      </div>
      {doc ? <>
        <div className="still-tabs">
          {doc.layers.length>0 && <button disabled={busy} aria-pressed={mode==='scene'} onClick={()=>switchMode('scene')}>图层合成</button>}
          {doc.videos.length>0 && <button disabled={busy} aria-pressed={mode==='video'} onClick={()=>switchMode('video')}>视频选帧</button>}
          <span>{mode==='scene' ? `${doc.width} × ${doc.height} 场景画布` : videoInfo.duration ? `${videoInfo.width} × ${videoInfo.height} · ${videoInfo.duration.toFixed(2)} 秒` : '正在读取视频…'}</span>
        </div>
        <div className="still-body">
          <div className="still-view">
            <div className="still-preview">
              {mode==='scene' ? <canvas ref={canvas} aria-label="合成整图预览"/> : <video ref={video} key={doc.videos[videoIndex]?.url} src={doc.videos[videoIndex]?.url} crossOrigin="anonymous" controls={!busy} muted preload="auto"
                onLoadedData={e=>{ const v=e.currentTarget; const size={width:v.videoWidth,height:v.videoHeight,duration:v.duration}; setVideoInfo(size); setWidth(size.width); setHeight(size.height); setFrames([]); setCurrent(0) }}
                onTimeUpdate={e=>setCurrent(e.currentTarget.currentTime)}
                onError={()=>setError('该视频编码无法播放。请先转换成 MP4(H.264) 或 WebM，再打开选帧。')}/>}
            </div>
            {mode==='scene' && previewError && <p className="still-error">{previewError}</p>}
            {mode==='video' && <div className="still-frame-tools">
              <select aria-label="视频文件" disabled={busy} value={videoIndex} onChange={e=>{setVideoIndex(Number(e.target.value));setFrames([]);setVideoInfo({width:0,height:0,duration:0});setError('')}}>{doc.videos.map((v,i)=><option value={i} key={v.url}>{v.name}</option>)}</select>
              <button disabled={busy || !videoInfo.duration} onClick={()=>addFrame(video.current?.currentTime ?? current)}><Camera size={15}/> 选取当前画面 {timeLabel(current)}</button>
              <div className="still-row"><input aria-label="指定选帧秒数" type="number" min="0" max={videoInfo.duration} step="0.001" value={manualTime} placeholder="输入秒数，例如 12.5" disabled={busy} onChange={e=>setManualTime(e.target.value)}/><button disabled={busy || !manualTime} onClick={()=>{ const time=Number(manualTime); addFrame(time); if(video.current && time>=0 && time<videoInfo.duration) void seekFrame(video.current,time).catch(e=>setError(message(e))) }}>添加时间点</button></div>
              <button disabled={busy || !videoInfo.duration} onClick={()=>setFrames([...new Set([0.1,0.3,0.5,0.7,0.9].map(p=>Math.floor(videoInfo.duration*p*1000)/1000))])}>均匀选取 5 帧</button>
              <p className="still-muted">播放或拖动视频选择画面，也可输入精确秒数。最多导出 24 帧。</p>
              <div className="still-frame-list">{frames.map(time=><button disabled={busy} key={time} title="点击移除" onClick={()=>setFrames(prev=>prev.filter(t=>t!==time))}>{timeLabel(time)} <X size={12}/></button>)}</div>
            </div>}
            {doc.warnings.length>0 && mode==='scene' && <details className="still-warnings"><summary>合成说明（{doc.warnings.length} 项）</summary>{doc.warnings.map(w=><p key={w}>{w}</p>)}</details>}
          </div>
          <aside className="still-sidebar">
            {mode==='scene' && <>
              <h3>选择图层</h3><p className="still-muted">按从底到顶排列。取消父图层会同时隐藏子图层。合成基础图像，动态特效、粒子和骨骼变形不保证还原。</p>
              <div className="still-row"><button disabled={busy} onClick={()=>{setEdits(defaultEdits(doc));setLayers(doc.layers)}}>恢复场景默认</button><button disabled={busy} onClick={()=>setEdits(prev=>Object.fromEntries(Object.entries(prev).map(([id,e])=>[id,{...e,visible:false}])))}>全部隐藏</button></div>
              <div className="still-layer-list">{doc.nodes.filter(n=>layers.some(l=>l.id===n.id) || doc.nodes.some(c=>c.parent===n.id)).sort((a,b)=>{const ai=layers.findIndex(l=>l.id===a.id),bi=layers.findIndex(l=>l.id===b.id);return ai<0 || bi<0 ? 0 : ai-bi}).map(node=>{
                const layer=layers.find(l=>l.id===node.id)
                const hidden=layer && !isVisible(layer,edits) && edits[node.id]?.visible
                return <div key={node.id} className={`still-layer ${selected===node.id?'active':''}`}>
                  <input type="checkbox" aria-label={`显示 ${node.name}`} disabled={busy} checked={edits[node.id]?.visible ?? false} onChange={e=>edit(node.id,{visible:e.target.checked})}/>
                  <button className="still-layer-name" disabled={busy} onClick={()=>setSelected(node.id)} title={node.name}>{node.name}<small>{layer ? `${layer.sourceWidth} × ${layer.sourceHeight}${hidden?' · 父图层已隐藏':''}` : '图层组 / 容器'}</small></button>
                  {layer && <div className="still-order"><button aria-label={`下移 ${node.name}`} disabled={busy || layers[0]?.id===node.id} onClick={()=>reorder(node.id,-1)}><ArrowDown size={12}/></button><button aria-label={`上移 ${node.name}`} disabled={busy || layers.at(-1)?.id===node.id} onClick={()=>reorder(node.id,1)}><ArrowUp size={12}/></button></div>}
                </div>
              })}</div>
              {selectedLayer && selectedEdit && <div className="still-adjust"><h3>调整所选图层</h3><p className="still-muted">{selectedLayer.name}</p>
                <div className="still-fields">{([{key:'x',label:'水平偏移',step:1,min:-32768,max:32768},{key:'y',label:'垂直偏移',step:1,min:-32768,max:32768},{key:'scale',label:'缩放倍率',step:0.01,min:0.01,max:20},{key:'rotation',label:'旋转角度',step:1,min:-360,max:360},{key:'opacity',label:'透明度',step:0.05,min:0,max:1}] as const).map(f=><label key={f.key}>{f.label}<input disabled={busy} type="number" value={selectedEdit[f.key]} min={f.min} max={f.max} step={f.step} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))edit(selected,{[f.key]:Math.max(f.min,Math.min(f.max,n))})}}/></label>)}</div>
                {!!selectedLayer.opacityMasks?.length && <label className="still-row"><input type="checkbox" disabled={busy} checked={selectedEdit.useMasks} onChange={e=>edit(selected,{useMasks:e.target.checked})}/> 使用壁纸自带的轮廓遮罩</label>}
                <label className="still-row">白边修复<select aria-label="白边修复" disabled={busy} value={selectedEdit.defringe} onChange={e=>edit(selected,{defringe:Number(e.target.value)})}><option value="0">关闭（保留原始描边）</option><option value="1">轻度</option><option value="2">较强</option></select></label>
                <p className="still-muted">优先使用原始遮罩。仍有白边时再开启修复；可关闭以保留发光和描边效果。</p>
                {selectedLayer.notes.map(note=><p className="still-muted" key={note}>{note}</p>)}
              </div>}
            </>}
            <h3>导出设置</h3>
            <div className="still-fields"><label>格式<select value={format} disabled={busy} onChange={e=>setFormat(e.target.value as 'png'|'jpg')}><option value="png">PNG 无损</option><option value="jpg">JPG</option></select></label>{format==='jpg' && <label>JPG 质量（1–100）<input type="number" min="1" max="100" value={quality} disabled={busy} onChange={e=>setQuality(Math.max(1,Math.min(100,e.target.valueAsNumber || 98)))}/></label>}
              <label>宽度<input aria-label="导出宽度" type="number" min="1" max="16384" disabled={busy} value={width || ''} onChange={e=>{const w=e.target.valueAsNumber || 0;setWidth(w);if(nativeSize?.width)setHeight(Math.round(w*nativeSize.height/nativeSize.width))}}/></label>
              <label>高度<input aria-label="导出高度" type="number" min="1" max="16384" disabled={busy} value={height || ''} onChange={e=>{const h=e.target.valueAsNumber || 0;setHeight(h);if(nativeSize?.height)setWidth(Math.round(h*nativeSize.width/nativeSize.height))}}/></label>
            </div>
            <button disabled={busy || !nativeSize?.width} onClick={()=>{setWidth(nativeSize!.width);setHeight(nativeSize!.height)}}>恢复原始分辨率</button>
            <p className="still-muted">保持原始比例。放大图片不会增加原素材细节。</p>
            {mode==='scene' && <div className="still-background"><label>背景色 <input type="color" value={/^#[0-9a-f]{6}$/i.test(background)?background:'#000000'} disabled={busy} onChange={e=>setBackground(e.target.value)}/></label>{format==='png' && <label><input type="checkbox" checked={transparent} disabled={busy} onChange={e=>setTransparent(e.target.checked)}/> 保留透明背景</label>}</div>}
          </aside>
        </div>
      </> : <div className="still-empty"><ImageIcon size={42}/><h3>把散开的素材，保存成一张完整壁纸</h3><p>打开原始壁纸文件夹可自动读取布局；已有散图可手动选择和叠加。</p><p>也支持打开视频，选取几个喜欢的瞬间。</p></div>}
      <footer className="still-footer">
        {error && <p role="alert" className="still-error">{error}</p>}
        {status && <p className="still-muted" role="status">{status}</p>}
        {saved.length>0 && <div className="still-saved">已保存 {saved.length} 张 <button onClick={()=>void window.wallpeel.openWallpaperDir(saved[0])}>打开保存目录</button></div>}
        <div className="still-footer-actions"><span>按完整画布导出，预览缩放不影响保存清晰度。</span><button className="still-primary" disabled={busy || !doc || (mode==='video' && !frames.length)} onClick={()=>void exportImages()}>{busy?'处理中…':mode==='scene'?'导出整张图片':`导出所选 ${frames.length} 帧`}</button></div>
      </footer>
    </section>
  </div>
}
