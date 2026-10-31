import { drawStaticMesh } from './static-mesh'
import { repairLightFringe } from './static-alpha'
import type { StillLayer, LayerEdit, makeImageCache } from './static-render'

const cache=new WeakMap<HTMLImageElement,Map<string,Promise<CanvasImageSource>>>()
export async function prepareLayer(image:HTMLImageElement,layer:StillLayer,edit:LayerEdit,loadImage:ReturnType<typeof makeImageCache>) {
  let entries=cache.get(image)
  if(!entries){entries=new Map();cache.set(image,entries)}
  const masks=edit.useMasks ? layer.opacityMasks ?? [] : []
  const key=JSON.stringify([layer.id,layer.width,layer.height,masks,edit.defringe])
  if(!entries.has(key))entries.set(key,(async()=>{
    const source=layer.mesh ? drawStaticMesh(image,layer) : image
    if(!masks.length&&!edit.defringe)return source
    const canvas=document.createElement('canvas')
    canvas.width=layer.mesh ? Math.ceil(layer.width) : image.naturalWidth
    canvas.height=layer.mesh ? Math.ceil(layer.height) : image.naturalHeight
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!
    ctx.drawImage(source,0,0,canvas.width,canvas.height)
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height)
    // Masks are in layer/effect space, after the saved puppet geometry has been drawn.
    for(const mask of masks){
      let maskPixels:Uint8ClampedArray|undefined
      if(mask.url){
        const image=await loadImage(mask.url)
        const surface=document.createElement('canvas');surface.width=canvas.width;surface.height=canvas.height
        const mctx=surface.getContext('2d',{willReadFrequently:true})!
        mctx.drawImage(image,0,0,surface.width,surface.height)
        maskPixels=mctx.getImageData(0,0,surface.width,surface.height).data
      }
      for(let i=0;i<pixels.data.length;i+=4)pixels.data[i+3]*=(maskPixels ? maskPixels[i]/255 : 1)*mask.alpha
    }
    repairLightFringe(pixels.data,canvas.width,canvas.height,edit.defringe)
    ctx.putImageData(pixels,0,0)
    return canvas
  })().catch(error=>{entries!.delete(key);throw error}))
  return entries.get(key)!
}
