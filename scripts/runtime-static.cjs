// Optional desktop smoke check, run in an Electron runtime, not node --test.
// WALLPEEL_SAMPLE points to a read-only real PKG; all outputs go to output/runtime-check.
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname,'..')
const output = path.join(root,'output','runtime-check-'+Date.now())
app.setAppPath(root)
require('node:fs').mkdirSync(path.join(root,'output','runtime-userdata'),{recursive:true})
app.setPath('userData',path.join(root,'output','runtime-userdata'))
const sample = process.env.WALLPEEL_SAMPLE
let input = sample
dialog.showOpenDialog = async (_window, options) => ({canceled:false,filePaths:[options.title === '选择静态壁纸保存位置' ? output : input]})
require('../electron/main.cjs')
ipcMain.removeHandler('wallpaper:autoFind')
ipcMain.handle('wallpaper:autoFind',()=>({paths:[],count:0}))
const timeout=setTimeout(()=>{console.error('Runtime check timed out');app.exit(1)},90000)
app.whenReady().then(async()=>{
  const initial=BrowserWindow.getAllWindows()[0]
  const win=new BrowserWindow({width:1400,height:900,show:false,webPreferences:{offscreen:true,preload:path.join(root,'electron','preload.cjs'),contextIsolation:true,nodeIntegration:false}})
  initial.destroy()
  await win.loadFile(path.join(root,'dist','index.html'))
  win.webContents.on('console-message',(_e,level,text)=>{if(level>=2)console.error('renderer:',text)})
  async function run(code) { return win.webContents.executeJavaScript(code,true) }
  async function until(code) {
    for(let i=0;i<250;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,100))}
    throw new Error(`UI condition failed: ${code}`)
  }
  async function click(text) { return run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});if(b.disabled)throw Error('Disabled '+${JSON.stringify(text)});b.click()})()`)}
  try {
    await fs.mkdir(output,{recursive:true})
    await until(`document.querySelector('header')`)
    await click('导出静态壁纸'); await until(`document.querySelector('.still-empty')`)
    await click('打开壁纸 / 散图文件夹')
    await until(`document.querySelector('.still-preview canvas')?.width===1000 && !document.querySelector('.still-primary')?.disabled`)
    await until(`document.querySelector('.still-preview canvas').getContext('2d').getImageData(100,100,1,1).data[3]>0`)
    await fs.writeFile(path.join(output,'scene-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())
    await click('导出整张图片')
    await until(`document.querySelector('.still-saved')?.textContent.includes('已保存 1 张')`)
    const sceneFiles=(await fs.readdir(output)).filter(f=>f.endsWith('.png') && f!=='scene-ui.png')
    const sharp=require('sharp')
    const meta=await sharp(path.join(output,sceneFiles.at(-1))).metadata()
    assert.equal(meta.width,3840); assert.equal(meta.height,2160)
    await run(`(()=>{const s=document.querySelector('.still-fields select');s.value='jpg';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await until(`document.querySelector('.still-fields select')?.value==='jpg'`)
    await click('导出整张图片')
    await until(`document.querySelector('.still-saved')?.textContent.includes('已保存 1 张') && document.querySelector('.still-footer [role="status"]')?.textContent.startsWith('已保存到')`)
    const jpeg=(await fs.readdir(output)).find(f=>f.endsWith('.jpg'))
    assert.ok(jpeg,'JPG export should produce a JPEG file')
    const jpegMeta=await sharp(path.join(output,jpeg)).metadata()
    assert.equal(jpegMeta.format,'jpeg');assert.equal(jpegMeta.width,3840);assert.equal(jpegMeta.height,2160)
    await run(`document.querySelector('[aria-label="关闭静态导出"]').click()`)
    // Use an asymmetric colour-changing clip, so stale/wrong-time frame reads are visible.
    input=path.join(root,'sample.local','frames.mp4')
    await click('导出静态壁纸');await until(`document.querySelector('.still-empty')`)
    await click('打开 PKG / MPKG / 视频')
    await until(`document.querySelector('video')?.readyState>=2 && document.querySelector('video')?.duration>0`)
    await click('均匀选取 5 帧');await until(`document.querySelectorAll('.still-frame-list button').length===5`)
    await click('导出所选 5 帧')
    await until(`document.querySelector('.still-saved')?.textContent.includes('已保存 5 张')`)
    const frames=(await fs.readdir(output)).filter(f=>f.startsWith('frames-') && f.endsWith('.png')).sort()
    assert.equal(frames.length,5)
    const colors=[]
    for(const file of frames){const m=await sharp(path.join(output,file)).metadata();assert.equal(m.width,320);assert.equal(m.height,180);colors.push([...await sharp(path.join(output,file)).extract({left:160,top:90,width:1,height:1}).removeAlpha().raw().toBuffer()])}
    assert.ok(colors[0][0]>180 && colors[0][1]<50,'first frame should be red')
    assert.ok(colors.at(-1)[1]>80 && colors.at(-1)[0]<50,'last frame should be green')
    await fs.writeFile(path.join(output,'video-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())
    await run(`document.querySelector('[aria-label="关闭静态导出"]').click()`)
    // Direct IPC prepares a second session to cover the loose-image entry point and range serving.
    const loose=await run(`window.wallpeel.staticExport.prepare(${JSON.stringify(process.env.WALLPEEL_LOOSE)})`)
    assert.equal(loose.hasScene,false);assert.equal(loose.layers.length,21);assert.equal(loose.nodes.filter(n=>n.visible).length,1)
    await run(`window.wallpeel.staticExport.release(${JSON.stringify(loose.id)})`)
    const sessions=await fs.readdir(require('node:os').tmpdir())
    console.log(JSON.stringify({passed:true,output,scene:sceneFiles.at(-1),jpeg,frames,colors,looseImages:loose.layers.length,tempSessions:sessions.filter(n=>n.startsWith('wallpeel-still-')).length},null,2))
    clearTimeout(timeout);app.quit()
  }catch(error){console.error(error);console.error(await run(`document.body.innerText`).catch(()=>''));clearTimeout(timeout);app.exit(1)}
})
