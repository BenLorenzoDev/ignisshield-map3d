/* Route segments are uploaded once. Playback and camera gestures only change uniforms;
 * no GeoJSON tiling, symbol placement or worker round trips are needed for each footstep. */
const IgnisWalkers = (() => {
  function create(map, images) {
    let gl, program, buffer, atlas, visibility, count = 0, minute = 0, seconds = 0, ref = [0, 0, 0], groupWidth = 1;
    let visibleKey = '', visiblePixels = new Uint8Array(4), visibilityDirty = true, vertexData = new Float32Array(0), dataDirty = false, renders = 0, renderedMinute = 0;
    const matrix = new Float32Array(16), corners = [[-1,0],[1,0],[1,1],[-1,0],[1,1],[-1,1]], stride = 11;
    const VS = `precision highp float;
      attribute vec3 a_start; attribute vec3 a_end; attribute vec2 a_times;
      attribute vec2 a_corner; attribute float a_group;
      uniform mat4 u_matrix; uniform vec2 u_viewport; uniform float u_minute;
      uniform float u_seconds; uniform float u_height; uniform float u_groups;
      uniform sampler2D u_visible; varying vec2 v_uv;
      void main() {
        float shown = texture2D(u_visible, vec2((a_group + 0.5) / u_groups, 0.5)).r;
        if (shown < 0.5 || u_minute < a_times.x || u_minute >= a_times.y) { gl_Position=vec4(2.0,2.0,2.0,1.0); v_uv=vec2(0.0); return; }
        float f = clamp((u_minute-a_times.x)/max(0.000001,a_times.y-a_times.x),0.0,1.0);
        vec4 base = u_matrix * vec4(mix(a_start,a_end,f),1.0);
        vec4 first = u_matrix * vec4(a_start,1.0), last = u_matrix * vec4(a_end,1.0);
        float faceLeft = step(last.x/last.w, first.x/first.w);
        float pose = mod(floor(u_seconds*6.0) + a_group,2.0)*2.0 + faceLeft;
        vec2 offset = vec2(a_corner.x*u_height*0.35,a_corner.y*u_height)*2.0/u_viewport;
        gl_Position=vec4(base.xy+offset*base.w,base.z,base.w);
        v_uv=vec2((pose+(a_corner.x+1.0)*0.5)/4.0,1.0-a_corner.y);
      }`;
    const FS = `precision mediump float; uniform sampler2D u_atlas; varying vec2 v_uv;
      void main(){vec4 c=texture2D(u_atlas,v_uv);if(c.a<0.05)discard;gl_FragColor=vec4(c.rgb*c.a,c.a);}`;
    const locations = {};
    function shader(type, source) {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function texture(width, height, pixels) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    const layer = {id: 'evac-walkers-gl', type: 'custom', renderingMode: '3d',
      onAdd(_, context) {
        gl = context; program = gl.createProgram();
        const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        gl.deleteShader(vs); gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        for (const name of ['matrix','viewport','minute','seconds','height','groups','visible','atlas']) locations[name] = gl.getUniformLocation(program, `u_${name}`);
        for (const name of ['start','end','times','corner','group']) locations[`a_${name}`] = gl.getAttribLocation(program, `a_${name}`);
        buffer = gl.createBuffer();
        const saved = gl.getParameter(gl.TEXTURE_BINDING_2D), w = images[0][1].width, h = images[0][1].height, pixels = new Uint8Array(w*h*4*4);
        images.forEach(([,img], k) => { for(let y=0;y<h;y++) pixels.set(img.data.subarray(y*w*4,(y+1)*w*4),(y*w*4+k*w)*4); });
        atlas = texture(w*4,h,pixels); visibility = texture(1,1,new Uint8Array(4));
        gl.bindTexture(gl.TEXTURE_2D,saved);
      },
      render(_, options) {
        if (!count) return;
        renders++; renderedMinute = minute;
        gl.bindVertexArray?.(null);
        const active = gl.getParameter(gl.ACTIVE_TEXTURE);
        gl.activeTexture(gl.TEXTURE0); const saved0 = gl.getParameter(gl.TEXTURE_BINDING_2D); gl.bindTexture(gl.TEXTURE_2D, atlas);
        gl.activeTexture(gl.TEXTURE1); const saved1 = gl.getParameter(gl.TEXTURE_BINDING_2D); gl.bindTexture(gl.TEXTURE_2D, visibility);
        if (visibilityDirty) { gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,groupWidth,1,0,gl.RGBA,gl.UNSIGNED_BYTE,visiblePixels); visibilityDirty=false; }
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        if (dataDirty) { gl.bufferData(gl.ARRAY_BUFFER,vertexData,gl.STATIC_DRAW); dataDirty=false; }
        const m = options.defaultProjectionData.mainMatrix;
        for (let i=0;i<12;i++) matrix[i]=m[i];
        for (let r=0;r<4;r++) matrix[12+r]=m[r]*ref[0]+m[4+r]*ref[1]+m[8+r]*ref[2]+m[12+r];
        gl.useProgram(program); gl.uniformMatrix4fv(locations.matrix,false,matrix);
        gl.uniform2f(locations.viewport,gl.drawingBufferWidth,gl.drawingBufferHeight);
        gl.uniform1f(locations.minute,minute);gl.uniform1f(locations.seconds,seconds);gl.uniform1f(locations.groups,groupWidth);
        const pixelRatio=gl.drawingBufferWidth/map.getCanvas().clientWidth;
        gl.uniform1f(locations.height,Math.max(8,Math.min(24,10+(map.getZoom()-16)*3))*pixelRatio);
        gl.uniform1i(locations.atlas,0);gl.uniform1i(locations.visible,1);
        let offset=0; const enabled=[];
        for (const [name,size] of [['start',3],['end',3],['times',2],['corner',2],['group',1]]) {
          const loc=locations[`a_${name}`];gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride*4,offset*4);offset+=size;enabled.push(loc);
        }
        gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);
        gl.drawArrays(gl.TRIANGLES,0,count);
        for(const loc of enabled)gl.disableVertexAttribArray(loc);
        gl.bindTexture(gl.TEXTURE_2D,saved1);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,saved0);gl.activeTexture(active);
      },
      onRemove() {gl.deleteBuffer(buffer);gl.deleteTexture(atlas);gl.deleteTexture(visibility);gl.deleteProgram(program);}
    };
    map.addLayer(layer, 'fire-gl');
    function setRun(groups) {
      const first=groups.find(g=>g.coords.length>1)?.coords[0];
      if (!first) {count=0;map.triggerRepaint();return;}
      const origin=maplibregl.MercatorCoordinate.fromLngLat(first);ref=[origin.x,origin.y,0];
      const packed=[], elevations=new Map();let maxGroup=0;
      const point=p=>{
        const key=p.map(v=>v.toFixed(7)).join(',');
        if(!elevations.has(key))elevations.set(key,map.queryTerrainElevation(p)??0);
        const m=maplibregl.MercatorCoordinate.fromLngLat(p,elevations.get(key)+0.15);
        return [m.x-ref[0],m.y-ref[1],m.z];
      };
      for(const g of groups){
        maxGroup=Math.max(maxGroup,g.i);
        const points=g.coords.map(point);
        for(let i=1;i<points.length;i++){
          if(g.times[i]<=g.times[i-1])continue;
          for(const corner of corners)packed.push(...points[i-1],...points[i],g.times[i-1],g.times[i],...corner,g.i);
        }
      }
      vertexData=new Float32Array(packed);count=vertexData.length/stride;dataDirty=true;
      groupWidth=2**Math.ceil(Math.log2(maxGroup+1));visiblePixels=new Uint8Array(groupWidth*4);visibleKey='';visibilityDirty=true;
      map.triggerRepaint();
    }
    function setVisible(ids) {
      const key=ids.join(',');if(key===visibleKey)return;visibleKey=key;visiblePixels.fill(0);
      for(const id of ids)visiblePixels[id*4]=255;visibilityDirty=true;map.triggerRepaint();
    }
    return {setRun,setVisible,setClock:(m,s)=>{minute=m;seconds=s;},clear:()=>{count=0;visibleKey='';map.triggerRepaint();},
      stats:()=>({segments:count/6,minute,renderedMinute,renders,visible:visibleKey?visibleKey.split(',').length:0})};
  }
  return {create};
})();
