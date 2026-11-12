/** Screen-projected point cloud, shared projection with CPU picking and Canvas fallback. */
export interface StarMapRenderer {
  /** points = [clipX, clipY, size, r, g, b, a] × N(clip 空间,投影由调用方算) */
  draw(points: number[], width: number, height: number): void;
  dispose(): void;
}

export function createStarMapGl(canvas: HTMLCanvasElement): StarMapRenderer | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const dispose = () => { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s)); };
  try {
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type); if (!s) throw new Error('shader allocation');
      shaders.push(s); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader compile');
      return s;
    };
    program = gl.createProgram(); if (!program) throw new Error('program allocation');
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      layout(location=0) in vec2 pos;
      layout(location=1) in float size;
      layout(location=2) in vec4 color;
      out vec4 tint;
      void main(){gl_Position=vec4(pos,0.,1.);gl_PointSize=size;tint=color;}`));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec4 tint; out vec4 outColor;
      void main(){if(length(gl_PointCoord-vec2(.5))>.5)discard;outColor=tint;}`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program link');
    buffer = gl.createBuffer(); if (!buffer) throw new Error('buffer allocation');
    return {
      draw(points: number[], width: number, height: number) {
        if (gl.isContextLost()) throw new Error('context lost');
        canvas.width = width; canvas.height = height;
        gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
        for (const [index, size, offset] of [[0, 2, 0], [1, 1, 8], [2, 4, 12]]) {
          gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, size, gl.FLOAT, false, 28, offset);
        }
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.POINTS, 0, points.length / 7);
      }, dispose,
    };
  } catch { dispose(); return null; }
}
