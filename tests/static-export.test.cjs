const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const sharp = require('sharp')
const { describe, safePath } = require('../electron/static-scene.cjs')
const { unpackMpkg, validatePkg } = require('../electron/static-export.cjs')
const { parseStaticMesh } = require('../electron/static-mesh.cjs')

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wallpeel-test-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  return root
}
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
const str=s=>Buffer.concat([u32(Buffer.byteLength(s)),Buffer.from(s)])
test('opacity effects follow their texture slot, saved alpha and visibility, without guessing masks',async t=>{
  const root=await fixture(t)
  await fs.mkdir(path.join(root,'materials','masks'),{recursive:true});await fs.mkdir(path.join(root,'models'))
  await sharp({create:{width:8,height:8,channels:4,background:'#ffffff'}}).png().toFile(path.join(root,'materials','art.png'))
  await sharp({create:{width:8,height:8,channels:4,background:'#808080'}}).png().toFile(path.join(root,'materials','masks','outline.png'))
  await fs.writeFile(path.join(root,'models','art.json'),JSON.stringify({material:'materials/art.json'}))
  await fs.writeFile(path.join(root,'materials','art.json'),JSON.stringify({passes:[{textures:['art']}]}))
  const opacity=(settings,visible=true)=>({file:'effects/opacity/effect.json',visible,passes:[settings]})
  await fs.writeFile(path.join(root,'scene.json'),JSON.stringify({general:{orthogonalprojection:{width:8,height:8}},objects:[{id:1,image:'models/art.json',effects:[
    opacity({textures:[null,'masks/outline'],constantshadervalues:{alpha:{value:.5}}}),
    opacity({textures:[null,'masks/missing']},false),
    opacity({textures:[null,'masks/outline'],combos:{MASK:0},constantshadervalues:{alpha:0}}),
    {file:'effects/iris/effect.json',passes:[{textures:[null,'masks/outline']}]},
  ]}]}))
  const doc=await describe(root,p=>p)
  assert.equal(doc.layers[0].opacityMasks.length,2)
  assert.ok(doc.layers[0].opacityMasks[0].url.endsWith('outline.png'))
  assert.equal(doc.layers[0].opacityMasks[0].alpha,.5)
  assert.deepEqual(doc.layers[0].opacityMasks[1],{url:null,alpha:0})
  assert.ok(!doc.warnings.some(w=>w.includes('缺少透明度遮罩')))
})
test('optional defringe repairs a light rim on dark material, preserving alpha and white fabric',async()=>{
  const {repairLightFringe}=await import('../src/lib/static-alpha.ts')
  const w=32,h=32,data=new Uint8ClampedArray(w*h*4)
  for(let y=5;y<27;y++)for(let x=5;x<27;x++){
    const i=(y*w+x)*4,v=x===5||x===26||y===5||y===26 ? 230 : 40
    data.set([v,v,v,255],i)
  }
  const original=new Uint8ClampedArray(data)
  repairLightFringe(data,w,h,0);assert.deepEqual(data,original)
  repairLightFringe(data,w,h,1)
  assert.ok(data[(16*w+5)*4]<100,'white contamination should adopt the nearby dark foreground colour')
  for(let i=3;i<data.length;i+=4)assert.equal(data[i],original[i],'alpha and thin silhouettes must not shrink')
  const white=new Uint8ClampedArray(original)
  for(let i=0;i<white.length;i+=4)if(white[i+3])white.set([240,242,245,255],i)
  const before=new Uint8ClampedArray(white);repairLightFringe(white,w,h,2)
  assert.deepEqual(white,before,'white clothes should not darken')
})
test('static facial mesh preserves its saved vertex positions instead of stretching the PNG',()=>{
  const header=Buffer.concat([Buffer.from('MDLV0023\0'),u32(0),u32(3*80)])
  const vertices=Buffer.alloc(3*80)
  for(const [i,[x,y,u,v]] of [[-20,12,0,0],[25,14,1,0],[0,-7,0.5,1]].entries()) {
    for(const [offset,n] of [[0,x],[4,y],[72,u],[76,v]]) vertices.writeFloatLE(n,i*80+offset)
  }
  const indices=Buffer.alloc(6);indices.writeUInt16LE(1,2);indices.writeUInt16LE(2,4)
  const data=Buffer.concat([header,vertices,u32(6),indices,Buffer.from('MDLS')])
  const mesh=parseStaticMesh(data)
  assert.deepEqual(mesh.positions,[-20,12,25,14,0,-7])
  assert.deepEqual(mesh.uvs,[0,0,1,0,0.5,1]);assert.deepEqual(mesh.indices,[0,1,2])
  indices.writeUInt16LE(9,4)
  assert.throws(()=>parseStaticMesh(Buffer.concat([header,vertices,u32(6),indices,Buffer.from('MDLS')])),/网格/)
})
test('scene follows material references, parent transforms and saved visibility; masks stay excluded',async t=>{
  const root=await fixture(t)
  await fs.mkdir(path.join(root,'materials')); await fs.mkdir(path.join(root,'models'))
  await sharp({create:{width:4,height:2,channels:4,background:'#ff0000'}}).png().toFile(path.join(root,'materials','art.png'))
  await fs.copyFile(path.join(root,'materials','art.png'),path.join(root,'materials','unused-mask.png'))
  await fs.writeFile(path.join(root,'models','art.json'),JSON.stringify({material:'materials/art.json'}))
  await fs.writeFile(path.join(root,'materials','art.json'),JSON.stringify({passes:[{textures:['art'],blending:'translucent'}]}))
  await fs.writeFile(path.join(root,'scene.json'),JSON.stringify({general:{orthogonalprojection:{width:16,height:8}},objects:[
    {id:1,name:'group',origin:'8 4 0',scale:'2 2 1',visible:{value:false}},
    {id:2,name:'art',parent:1,origin:'1 1 0',image:'models/art.json'},
  ]}))
  const doc=await describe(root,p=>p)
  assert.equal(doc.layers.length,1)
  assert.deepEqual(doc.layers[0].matrix.map(n=>n || 0),[2,0,0,2,10,-6])
  assert.deepEqual(doc.layers[0].ancestors,['1'])
  assert.equal(doc.nodes.find(n=>n.id==='1').visible,false)
  assert.equal(doc.width,16)
})
test('loose images keep native sizes and enable only the largest image',async t=>{
  const root=await fixture(t)
  for(const [name,width] of [['small',2],['large',8]]) await sharp({create:{width,height:4,channels:4,background:'#ffffff'}}).png().toFile(path.join(root,`${name}.png`))
  const doc=await describe(root,p=>p)
  assert.equal(doc.width,8); assert.equal(doc.height,4)
  assert.equal(doc.nodes.filter(n=>n.visible).length,1)
  assert.equal(doc.layers[0].name,'large.png')
})
test('MPKG preserves nested metadata and rejects traversal; PKG checks data bounds',async t=>{
  const root=await fixture(t)
  const data=Buffer.from('{}')
  const mpkg=name=>Buffer.concat([str('PKGM0014'),u32(1),str(name),u32(0),u32(data.length),data])
  const file=path.join(root,'test.mpkg')
  await fs.writeFile(file,mpkg('nested/scene.json')); await unpackMpkg(file,root)
  assert.equal(await fs.readFile(path.join(root,'nested','scene.json'),'utf8'),'{}')
  await fs.writeFile(file,mpkg('../escape.json')); await assert.rejects(unpackMpkg(file,root),/超出/)
  const pkg=path.join(root,'test.pkg')
  await fs.writeFile(pkg,Buffer.concat([str('PKGV0024'),u32(1),str('scene.json'),u32(0),u32(20),data]))
  await assert.rejects(validatePkg(pkg,root),/不完整/)
  for(const name of ['../outside','C:\\outside','/outside']) assert.throws(()=>safePath(root,name))
})
