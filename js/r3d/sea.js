'use strict';
/* Sea: one large plane with a small custom shader.
   - gentle vertex waves plus finer ripple normals in the fragment shader
   - colour from shallow to deep using a distance-to-land texture baked from the island
   - see-through shallows, shoreline foam, sun glints, linear fog matching the scene */
window.R3 = window.R3 || {};
(function (R3) {
  const RES = 4;        // distance texels per tile
  const MAXD = 4;       // distances are stored up to 4 tiles
  const PAD = 8;        // the texture reaches this many tiles past the map, so depth fades smoothly

  // Distance (in tiles) from each texel centre to the nearest land tile square.
  function distanceTexture() {
    const w = (MAP_W + PAD * 2) * RES, h = (MAP_H + PAD * 2) * RES, data = new Uint8Array(w * h);
    const land = [];
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (isLandTile(x, z)) land.push(x, z);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const px = (i + 0.5) / RES - PAD, pz = (j + 0.5) / RES - PAD;
      let best = MAXD * MAXD;
      for (let k = 0; k < land.length; k += 2) {
        const dx = Math.max(land[k] - px, 0, px - land[k] - 1), dz = Math.max(land[k + 1] - pz, 0, pz - land[k + 1] - 1);
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; if (d === 0) break; }
      }
      data[j * w + i] = Math.round(Math.min(1, Math.sqrt(best) / MAXD) * 255);
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  const WAVES = `
    uniform vec4 uInner;   // inner plane: centre x, centre z, half width, half depth
    float waveFade(vec2 p) {
      vec2 q = abs(p - uInner.xy) - (uInner.zw - 6.0);
      return 1.0 - smoothstep(0.0, 5.0, max(q.x, q.y));
    }
    float waveH(vec2 p, float t) {
      return (sin(p.x * 0.9 + t * 1.1) * 0.025 + sin(p.y * 1.3 - t * 0.9) * 0.02 + sin((p.x + p.y) * 0.55 + t * 0.6) * 0.03) * waveFade(p);
    }
    vec2 waveGrad(vec2 p, float t) {
      float c = cos((p.x + p.y) * 0.55 + t * 0.6) * 0.55 * 0.03;
      float gx = cos(p.x * 0.9 + t * 1.1) * 0.9 * 0.025 + c;
      float gz = cos(p.y * 1.3 - t * 0.9) * 1.3 * 0.02 + c;
      // finer ripples, lighting only
      gx += cos(p.x * 4.1 + p.y * 1.7 + t * 2.3) * 0.012 * 4.1 + cos(p.x * 7.3 - p.y * 5.1 - t * 3.1) * 0.006 * 7.3;
      gz += cos(p.x * 4.1 + p.y * 1.7 + t * 2.3) * 0.012 * 1.7 - cos(p.x * 7.3 - p.y * 5.1 - t * 3.1) * 0.006 * 5.1;
      return vec2(gx, gz);
    }`;

  const VERT = `
    uniform float uTime;
    varying vec3 vWorld;
    varying float vFogDepth;
    ${WAVES}
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      wp.y += waveH(wp.xz, uTime);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vFogDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;

  const FRAG = `
    uniform float uTime;
    uniform sampler2D uDist;
    uniform vec2 uMapSize;
    uniform vec3 uDeep, uShallow, uFoam, uSky, uSunDir, uSpec;
    uniform vec3 uFogColor;
    uniform float uFogNear, uFogFar;
    varying vec3 vWorld;
    varying float vFogDepth;
    ${WAVES}
    void main() {
      vec2 uv = (vWorld.xz + ${PAD.toFixed(1)}) / uMapSize;
      float d = ${MAXD.toFixed(1)};
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) d = texture2D(uDist, uv).r * ${MAXD.toFixed(1)};
      vec2 g = waveGrad(vWorld.xz, uTime);
      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
      vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 3.0, d));
      col = mix(col, uSky, fres * 0.45);
      vec3 hv = normalize(normalize(uSunDir) + v);
      col += uSpec * pow(max(dot(n, hv), 0.0), 120.0) * 0.8;
      // shoreline foam: a solid band plus lines rolling in towards the beach
      float band = 1.0 - smoothstep(0.0, 0.18, d + sin(vWorld.x * 3.0 + uTime * 1.3) * 0.03);
      float roll = smoothstep(0.82, 1.0, sin(d * 16.0 - uTime * 2.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.15, 0.7, d));
      float foam = clamp(band * 0.9 + roll * 0.55, 0.0, 1.0);
      col = mix(col, uFoam, foam);
      float alpha = mix(0.5, 1.0, smoothstep(0.0, 2.6, d));
      alpha = max(alpha, foam * 0.95);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vFogDepth));
      gl_FragColor = vec4(col, alpha);
      #include <colorspace_fragment>
    }`;

  R3.Sea = {
    build(theme) {
      const tex = distanceTexture();
      const uniforms = {
        uTime: { value: 0 }, uDist: { value: tex }, uMapSize: { value: new THREE.Vector2(MAP_W + PAD * 2, MAP_H + PAD * 2) },
        uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
        uSky: { value: new THREE.Color() }, uSpec: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
        uFogColor: { value: new THREE.Color() }, uFogNear: { value: 30 }, uFogFar: { value: 80 },
        uInner: { value: new THREE.Vector4() }
      };
      const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
      // Detailed inner plane (with waves) around the island, and a huge flat ring around it
      // with a matching hole, so the sea reaches the horizon without millions of triangles.
      const cx = MAP_W / 2, cz = MAP_H / 2, hw = MAP_W / 2 + 14, hd = MAP_H / 2 + 14, FAR = 700;
      uniforms.uInner.value.set(cx, cz, hw, hd);
      const inner = new THREE.PlaneGeometry(hw * 2, hd * 2, Math.round(hw * 2.4), Math.round(hd * 2.4));
      inner.rotateX(-Math.PI / 2); inner.translate(cx, 0, cz);
      const shape = new THREE.Shape([new THREE.Vector2(cx - FAR, cz - FAR), new THREE.Vector2(cx + FAR, cz - FAR), new THREE.Vector2(cx + FAR, cz + FAR), new THREE.Vector2(cx - FAR, cz + FAR)]);
      shape.holes.push(new THREE.Path([new THREE.Vector2(cx - hw, cz - hd), new THREE.Vector2(cx - hw, cz + hd), new THREE.Vector2(cx + hw, cz + hd), new THREE.Vector2(cx + hw, cz - hd)]));
      const outer = new THREE.ShapeGeometry(shape);
      outer.rotateX(Math.PI / 2);   // shape is in XY; this maps y -> z with the face pointing up
      const mesh = new THREE.Group();
      const mi = new THREE.Mesh(inner, mat), mo = new THREE.Mesh(outer, mat);
      mi.renderOrder = 1; mo.renderOrder = 1;
      mo.material = mat.clone(); mo.material.side = THREE.DoubleSide;
      mo.material.uniforms = uniforms;
      mesh.add(mi, mo);
      const geo = { dispose() { inner.dispose(); outer.dispose(); mo.material.dispose(); } };
      const api = {
        mesh,
        setTheme(th) {
          uniforms.uDeep.value.setHex(th.seaDeep); uniforms.uShallow.value.setHex(th.seaShallow);
          uniforms.uFoam.value.setHex(th.foam); uniforms.uSky.value.setHex(th.sky); uniforms.uSpec.value.setHex(th.seaSpec);
          uniforms.uSunDir.value.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
          uniforms.uFogColor.value.setHex(th.fog); uniforms.uFogNear.value = th.fogNear; uniforms.uFogFar.value = th.fogFar;
        },
        update(t) { uniforms.uTime.value = t; },
        dispose() { geo.dispose(); mat.dispose(); tex.dispose(); }
      };
      api.setTheme(theme);
      return api;
    }
  };
})(window.R3);
