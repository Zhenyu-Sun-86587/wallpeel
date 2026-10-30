import type { StillLayer } from './static-render'

// Rasterize the saved mesh rather than stretching the full PNG rectangle.
// WebGL draws shared triangle edges without seams, which matters for facial details.
export function drawStaticMesh(image: HTMLImageElement, layer: StillLayer): HTMLCanvasElement {
  const mesh=layer.mesh!
  const canvas=document.createElement('canvas')
  canvas.width=Math.ceil(layer.width);canvas.height=Math.ceil(layer.height)
  const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:true})
  if(!gl) throw new Error('无法初始化图形渲染，骨骼图层不能准确合成')
  const resources: {buffers:WebGLBuffer[];shaders:WebGLShader[];program:WebGLProgram|null;texture:WebGLTexture|null}={buffers:[],shaders:[],program:null,texture:null}
  try {
    function shader(type:number,source:string) {
      const s=gl!.createShader(type)!
      resources.shaders.push(s);gl!.shaderSource(s,source);gl!.compileShader(s)
      if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS)) throw new Error('静态模型着色器编译失败')
      return s
    }
    const program=gl.createProgram()!
    resources.program=program
    gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 position; attribute vec2 uv; uniform vec2 size; varying vec2 texcoord; void main(){ gl_Position=vec4(2.0*position/size,0.0,1.0); texcoord=uv; }'))
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float; uniform sampler2D image; varying vec2 texcoord; void main(){gl_FragColor=texture2D(image,texcoord);}'))
    gl.linkProgram(program)
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('静态模型着色器连接失败')
    gl.useProgram(program)
    function attribute(name:string,values:number[]) {
      const buffer=gl!.createBuffer()!;resources.buffers.push(buffer)
      gl!.bindBuffer(gl!.ARRAY_BUFFER,buffer);gl!.bufferData(gl!.ARRAY_BUFFER,new Float32Array(values),gl!.STATIC_DRAW)
      const location=gl!.getAttribLocation(program,name)
      gl!.enableVertexAttribArray(location);gl!.vertexAttribPointer(location,2,gl!.FLOAT,false,0,0)
    }
    attribute('position',mesh.positions);attribute('uv',mesh.uvs)
    const indices=gl.createBuffer()!;resources.buffers.push(indices)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(mesh.indices),gl.STATIC_DRAW)
    const texture=gl.createTexture()!;resources.texture=texture
    gl.bindTexture(gl.TEXTURE_2D,texture)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image)
    gl.uniform2f(gl.getUniformLocation(program,'size'),layer.width,layer.height)
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0)
    if(gl.getError()!==gl.NO_ERROR) throw new Error('静态模型绘制失败')
    // Copy now: releasing the GL context must not invalidate a cached composite.
    const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height
    copy.getContext('2d')!.drawImage(canvas,0,0)
    return copy
  } finally {
    for(const buffer of resources.buffers)gl.deleteBuffer(buffer)
    for(const shader of resources.shaders)gl.deleteShader(shader)
    if(resources.texture)gl.deleteTexture(resources.texture)
    if(resources.program)gl.deleteProgram(resources.program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
