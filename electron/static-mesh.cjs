// Read the saved 2D puppet geometry, without executing bones, animations or scripts.
// MDLV0021/23 have 80-byte vertices: xyz at 0 and texture UV at 72.
function parseStaticMesh(buffer) {
  if (!['MDLV0021','MDLV0023'].includes(buffer.toString('ascii',0,8))) throw new Error('不支持的骨骼模型版本')
  const marker=buffer.indexOf('MDLS',9)
  const end=marker<0?buffer.length:marker
  for(let start=9;start+12<end;start++) {
    const vertexBytes=buffer.readUInt32LE(start+4)
    const indexOffset=start+8+vertexBytes
    if(!vertexBytes || vertexBytes%80 || vertexBytes/80>65535 || indexOffset+4>end) continue
    const indexBytes=buffer.readUInt32LE(indexOffset)
    if(!indexBytes || indexBytes%6 || indexOffset+4+indexBytes>end) continue
    const count=vertexBytes/80
    const positions=[],uvs=[],indices=[]
    let valid=true
    for(let i=0;i<count;i++) {
      const offset=start+8+i*80
      const x=buffer.readFloatLE(offset),y=buffer.readFloatLE(offset+4)
      const u=buffer.readFloatLE(offset+72),v=buffer.readFloatLE(offset+76)
      if(![x,y,u,v].every(Number.isFinite) || Math.abs(x)>100000 || Math.abs(y)>100000 || Math.abs(u)>100 || Math.abs(v)>100) {valid=false;break}
      positions.push(x,y);uvs.push(u,v)
    }
    if(!valid) continue
    for(let i=indexOffset+4;i<indexOffset+4+indexBytes;i+=2) {
      const index=buffer.readUInt16LE(i)
      if(index>=count){valid=false;break}
      indices.push(index)
    }
    if(valid && indices.length>=3) return {positions,uvs,indices}
  }
  throw new Error('找不到有效的静态骨骼网格')
}
module.exports={parseStaticMesh}
