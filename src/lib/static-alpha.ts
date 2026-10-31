// Repair bright matte contamination on the outside of dark material.
// Does not erode alpha or replace colours inside the subject.
export function repairLightFringe(data: Uint8ClampedArray, width: number, height: number, strength: number) {
  if (strength <= 0) return
  const radius = strength > 1 ? 7 : 5
  const band = strength > 1 ? 5 : 3
  const distance = new Float32Array(width * height)
  for (let i=0;i<distance.length;i++) distance[i]=data[i*4+3]<128 ? 0 : 10000
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x
    if(x)distance[i]=Math.min(distance[i],distance[i-1]+1)
    if(y)distance[i]=Math.min(distance[i],distance[i-width]+1)
    if(x&&y)distance[i]=Math.min(distance[i],distance[i-width-1]+1.414)
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--) {
    const i=y*width+x
    if(x+1<width)distance[i]=Math.min(distance[i],distance[i+1]+1)
    if(y+1<height)distance[i]=Math.min(distance[i],distance[i+width]+1)
    if(x+1<width&&y+1<height)distance[i]=Math.min(distance[i],distance[i+width+1]+1.414)
  }
  const original=new Uint8ClampedArray(data)
  const luma=(i:number)=>.2126*original[i]+.7152*original[i+1]+.0722*original[i+2]
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x,j=i*4
    if(original[j+3]<20||distance[i]>band||luma(j)<140)continue
    let best=-1,nearest=Infinity
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++) {
      if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue
      const n=i+dy*width+dx,d=dx*dx+dy*dy
      if(d<nearest&&distance[n]>=band&&original[n*4+3]>245){best=n;nearest=d}
    }
    if(best<0)continue
    const k=best*4,inner=luma(k),difference=luma(j)-inner
    if(inner>=145||difference<55)continue
    const amount=Math.min(1,(difference-35)/65)
    for(let c=0;c<3;c++)data[j+c]=original[j+c]*(1-amount)+original[k+c]*amount
  }
}
