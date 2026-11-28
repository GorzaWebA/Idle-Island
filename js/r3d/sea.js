'use strict';
/* Sea: one large plane with a small custom shader.
   - gentle vertex waves plus finer ripple normals in the fragment shader
   - colour from shallow to deep using a distance-to-land texture baked from the island
   - see-through shallows, sun glints, linear fog matching the scene
   - surf: a second channel of that texture marks beaches, so waves wash up onto the sand while
     cliffs only get a thin line of foam */
window.R3 = window.R3 || {};
(function (R3) {
  const RES = 4;        // distance texels per tile
  const MAXD = 4;       // distances are stored up to 4 tiles
  const PAD = 8;        // the texture reaches this many tiles past the map, so depth fades smoothly

  /* Per texel:
       R: distance (in tiles) to the nearest land tile square
       G: distance to the nearest beach tile, so surf rolls onto beaches and cliffs get a thin line
       B: how deep the water stands over the sand (beach tiles slope under the surface). Sea next
          to a beach carries on from the depth at the beach's edge, so the shoreline measure
          (R + depth) is continuous and foam follows the real waterline, not the tile squares.
     Only tiles within MAXD are looked at. */
  const SUB = 0.12;     // B channel range (tiles of depth)
  function distanceTexture() {
    const w = (MAP_W + PAD * 2) * RES, h = (MAP_H + PAD * 2) * RES, data = new Uint8Array(w * h * 4);
    const kind = new Uint8Array(MAP_W * MAP_H);        // 0 sea, 1 land, 2 beach
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) kind[z * MAP_W + x] = isLandTile(x, z) ? (tileType(x, z) === T_SAND ? 2 : 1) : 0;
    const R = MAXD + 1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const px = (i + 0.5) / RES - PAD, pz = (j + 0.5) / RES - PAD;
      let land = MAXD * MAXD, sand = MAXD * MAXD;
      const x0 = Math.max(0, Math.floor(px) - R), x1 = Math.min(MAP_W - 1, Math.floor(px) + R);
      const z0 = Math.max(0, Math.floor(pz) - R), z1 = Math.min(MAP_H - 1, Math.floor(pz) + R);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const k = kind[z * MAP_W + x];
        if (!k) continue;
        const dx = Math.max(x - px, 0, px - x - 1), dz = Math.max(z - pz, 0, pz - z - 1), d = dx * dx + dz * dz;
        if (d < land) land = d;
        if (k === 2 && d < sand) sand = d;
      }
      const o = (j * w + i) * 4, dl = Math.sqrt(land), ds = Math.sqrt(sand);
      let sub = 0;
      if (land === 0) sub = Math.max(0, -R3.Terrain.heightAt(px, pz));
      else { const k = Math.max(0, Math.min(1, (ds - dl) / 0.3)); sub = 0.06 * (1 - k * k * (3 - 2 * k)); }
      data[o] = Math.round(Math.min(1, dl / MAXD) * 255);
      data[o + 1] = Math.round(Math.min(1, ds / MAXD) * 255);
      data[o + 2] = Math.round(Math.min(1, sub / SUB) * 255);
      data[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
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
      float d = ${MAXD.toFixed(1)}, db = ${MAXD.toFixed(1)};
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        vec4 tx = texture2D(uDist, uv);
        db = tx.g * ${MAXD.toFixed(1)};
        d = tx.r * ${MAXD.toFixed(1)};
        db += tx.b * ${(SUB * 3).toFixed(2)};
        d += tx.b * ${(SUB * 3).toFixed(2)};     // shoreline measure: distance plus depth over sand
      }
      // how much of a beach this stretch of shore is: 1 on a beach, 0 under a cliff
      float beach = 1.0 - smoothstep(0.25, 1.2, db - d);
      vec2 g = waveGrad(vWorld.xz, uTime);
      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
      vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 3.0, d));
      col = mix(col, uSky, fres * 0.45);
      vec3 hv = normalize(normalize(uSunDir) + v);
      col += uSpec * pow(max(dot(n, hv), 0.0), 120.0) * 0.8;
      // shoreline foam. Cliffs: a thin line that breathes. Beaches: surf that washes up and back,
      // with breaking lines rolling in towards the sand.
      float wob = sin(vWorld.x * 3.0 + vWorld.z * 1.7 + uTime * 1.3) * 0.03;
      float swash = 0.5 + 0.5 * sin(uTime * 0.9 + vWorld.x * 0.35 - vWorld.z * 0.25);
      float width = mix(0.085 + 0.03 * sin(uTime * 1.7 + vWorld.z * 2.0), 0.1 + 0.15 * swash, beach);
      float band = 1.0 - smoothstep(width * 0.45, width, d + wob);
      float lines = smoothstep(0.88, 1.0, sin(d * mix(16.0, 10.0, beach) + uTime * mix(2.0, 1.5, beach)) * 0.5 + 0.5);
      float roll = lines * (1.0 - smoothstep(0.1, mix(0.5, 1.4, beach), d)) * mix(0.3, 0.65, beach);
      float foam = clamp(band * mix(0.92, 0.78, beach) + roll * 0.6, 0.0, 1.0);
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
      mo.material = mat.clone(); mo.material.side = THREE.DoubleSide; mo.material.forceSinglePass = true;
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
        setFog(near, far) { uniforms.uFogNear.value = near; uniforms.uFogFar.value = far; },
        setSun(d) { uniforms.uSunDir.value.copy(d); },
        dispose() { geo.dispose(); mat.dispose(); tex.dispose(); }
      };
      api.setTheme(theme);
      return api;
    }
  };
})(window.R3);
