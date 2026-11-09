/* Street-level mode: Google Photorealistic 3D Tiles in CesiumJS.
 *
 * Tap the globe -> fly in -> drop to eye height and walk.
 * Sun = real position for that place and minute (Cesium SunLight + SunCalc for the tint).
 * Weather = live Open-Meteo. People = modelled crowd walking the real OSM street network.
 */
(async () => {
  'use strict';
  const O = window.OMA;
  const { DEG, clamp, lerp } = O;
  const $ = (id) => document.getElementById(id);
  const KEY = window.OMA_GOOGLE_KEY;
  const EYE = 1.65;          // eye height (m)
  const WALK = 1.4, RUN = 4; // m/s
  const M_PER_DEG_LAT = 111320;

  const state = { here: null, utcOffsetSec: null, tzName: '', weather: null, shiftHours: 0, mode: 'globe', coverage: 0, crowdTarget: 0 };
  const simNow = () => new Date(Date.now() + state.shiftHours * 3600e3);
  const pad = (n) => String(n).padStart(2, '0');
  const kDeg = (lat) => ({ lat: 1 / M_PER_DEG_LAT, lng: 1 / (M_PER_DEG_LAT * Math.cos(lat * DEG)) });

  document.body.classList.add('street-mode');

  // ---------- viewer ----------
  const viewer = new Cesium.Viewer('map', {
    globe: false, baseLayer: false, baseLayerPicker: false, geocoder: false, timeline: false, animation: false,
    homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false, shadows: true, msaaSamples: 4,
    skyAtmosphere: new Cesium.SkyAtmosphere(),
  });
  const scene = viewer.scene, camera = scene.camera;
  scene.light = new Cesium.SunLight();
  scene.skyAtmosphere.show = true;
  scene.shadowMap.softShadows = true;
  scene.shadowMap.size = 2048;
  scene.shadowMap.maximumDistance = 400;
  scene.shadowMap.darkness = 0.45;
  viewer.clock.shouldAnimate = true;
  camera.frustum.fov = 70 * DEG;
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit('Streets © OpenStreetMap · Weather Open-Meteo · Places BigDataCloud'));

  let tileset;
  try {
    tileset = await Cesium.Cesium3DTileset.fromUrl(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(KEY)}`, {
      showCreditsOnScreen: true, maximumScreenSpaceError: 8, shadows: Cesium.ShadowMode.ENABLED,
    });
    scene.primitives.add(tileset);
  } catch (err) {
    console.error('Google 3D tiles failed', err);
    try { localStorage.removeItem('oma.gkey'); } catch { /* ignore */ }
    location.replace(`${location.pathname}?engine=map&gerr=1${location.hash}`);
    return;
  }

  camera.setView({ destination: Cesium.Cartesian3.fromDegrees(135, 25, 2.2e7) });

  // ---------- people (billboards) ----------
  const peopleBB = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  const CLOTHES = ['#2b2d33', '#3d4a66', '#6b3a3a', '#e8e4dc', '#9aa3ad', '#1f3b2d', '#c9a227', '#b5462f', '#4d6fa8', '#f2f2f2', '#5a4632', '#202020'];
  const UMBRELLAS = ['#1b1b1b', '#24324f', '#7d1f2b', '#e7e7e7', '#2f5f8a'];
  const SKIN = ['#f1d3b6', '#d9a27a', '#a8714c', '#6b4429'];

  function personSprite(cloth, skin, legs, frame, umbrella) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 192;
    const g = c.getContext('2d');
    const cx = 32;
    // legs
    g.strokeStyle = legs; g.lineWidth = 9; g.lineCap = 'round';
    const swing = frame ? 9 : -9;
    g.beginPath(); g.moveTo(cx - 4, 112); g.lineTo(cx - 4 + swing, 184); g.moveTo(cx + 4, 112); g.lineTo(cx + 4 - swing, 184); g.stroke();
    // torso
    g.fillStyle = cloth;
    g.beginPath(); g.roundRect(cx - 14, 50, 28, 68, 10); g.fill();
    // arms
    g.strokeStyle = cloth; g.lineWidth = 7;
    g.beginPath(); g.moveTo(cx - 13, 58); g.lineTo(cx - 16 - swing * 0.5, 108); g.moveTo(cx + 13, 58); g.lineTo(cx + 16 + swing * 0.5, 108); g.stroke();
    // head
    g.fillStyle = skin; g.beginPath(); g.arc(cx, 34, 13, 0, 6.283); g.fill();
    g.fillStyle = '#1c1a18'; g.beginPath(); g.arc(cx, 29, 13, Math.PI, 0); g.fill();
    if (umbrella) {
      g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 12, 70); g.lineTo(cx + 12, 8); g.stroke();
      g.fillStyle = umbrella; g.beginPath(); g.ellipse(cx + 8, 10, 30, 10, 0, Math.PI, 0); g.fill();
    }
    return c;
  }

  // ---------- OSM streets from OpenFreeMap vector tiles ----------
  let tileTemplate = null;
  let VectorTile, Pbf;
  async function loadDecoder() {
    if (VectorTile) return;
    const [vt, pbf] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm'),
      import('https://cdn.jsdelivr.net/npm/pbf@4.0.1/+esm'),
    ]);
    VectorTile = vt.VectorTile; Pbf = pbf.default || pbf.Pbf;
    const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
    tileTemplate = tj.tiles[0];
  }

  async function osmAround(p, radius) {
    await loadDecoder();
    const z = 14, n = 2 ** z;
    const fx = (p.lng + 180) / 360 * n;
    const fy = (1 - Math.log(Math.tan(p.lat * DEG) + 1 / Math.cos(p.lat * DEG)) / Math.PI) / 2 * n;
    const tileM = 40075016 * Math.cos(p.lat * DEG) / n;
    const r = radius / tileM;
    const xs = new Set([Math.floor(fx - r), Math.floor(fx), Math.floor(fx + r)]);
    const ys = new Set([Math.floor(fy - r), Math.floor(fy), Math.floor(fy + r)]);
    const roads = [], buildings = [];
    await Promise.all([...xs].flatMap((x) => [...ys].map(async (y) => {
      const url = tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const buf = await (await fetch(url)).arrayBuffer();
      const tile = new VectorTile(new Pbf(new Uint8Array(buf)));
      const t = tile.layers.transportation, b = tile.layers.building;
      if (t) for (let i = 0; i < t.length; i++) roads.push(t.feature(i).toGeoJSON(x, y, z));
      if (b) for (let i = 0; i < b.length; i++) buildings.push(b.feature(i).toGeoJSON(x, y, z));
    })));
    return { roads, buildings };
  }

  const WALKABLE = {
    path: { w: 3.0, side: 0.6 }, pedestrian: { w: 3.5, side: 2 }, minor: { w: 1.4, side: 3.5 }, tertiary: { w: 1.8, side: 5.5 },
    secondary: { w: 2.0, side: 7 }, primary: { w: 2.0, side: 9 }, service: { w: 0.5, side: 2 }, track: { w: 0.2, side: 1 },
  };

  const people = (() => {
    let net = null, walkers = [], ground = null;

    function clear() { net = null; walkers = []; peopleBB.removeAll(); $('crowd').textContent = '—'; }

    async function build(center) {
      clear();
      $('crowd').textContent = 'reading the streets…';
      let osm;
      try { osm = await osmAround(center, 450); } catch (e) { console.warn(e); $('crowd').textContent = 'street data unavailable'; return; }
      if (state.here !== center) return;
      const k = kDeg(center.lat);
      const toXY = ([lng, lat]) => [(lng - center.lng) / k.lng, (lat - center.lat) / k.lat];
      const lines = [];
      for (const f of osm.roads) {
        const p = f.properties;
        if (p.brunnel === 'tunnel' || p.brunnel === 'bridge') continue;
        const cls = p.class === 'path' ? (p.subclass === 'pedestrian' ? 'pedestrian' : 'path') : p.class;
        const spec = WALKABLE[cls]; if (!spec) continue;
        const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
        for (const coords of parts) {
          const pts = coords.map(toXY);
          if (!pts.some(([x, y]) => x * x + y * y < 350 * 350)) continue;
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const len = cum[cum.length - 1];
          if (len > 3) lines.push({ pts, cum, len, side: spec.side, w: spec.w * len });
        }
      }
      // built-up coverage within 300 m
      let area = 0;
      for (const f of osm.buildings) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
        for (const poly of polys) {
          const ring = poly[0].map(toXY);
          if (ring[0][0] ** 2 + ring[0][1] ** 2 > 300 * 300) continue;
          let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
          area += Math.abs(a) / 2;
        }
      }
      state.coverage = clamp(area / (Math.PI * 300 * 300), 0, 1);

      const nodes = new Map(), key = ([x, y]) => `${Math.round(x)},${Math.round(y)}`;
      lines.forEach((l, i) => [[0, l.pts[0]], [1, l.pts[l.pts.length - 1]]].forEach(([end, pt]) => {
        const kk = key(pt); if (!nodes.has(kk)) nodes.set(kk, []); nodes.get(kk).push({ i, end });
      }));
      let total = 0; const pick = lines.map((l) => (total += l.w));
      net = { origin: center, k, lines, nodes, pick, total, key };

      ground = await groundGrid(center, lines);
      if (state.here !== center) return;
      updateTarget(true);
    }

    // Street-level height field: sample real 3D-tile heights at street vertices and
    // keep the lowest per 40 m cell (lowest = road surface, not trees or awnings).
    async function groundGrid(center, lines) {
      const CELL = 40, N = 20; // 800 m square
      const verts = [];
      for (const l of lines) for (let i = 0; i < l.pts.length; i += Math.max(1, Math.floor(l.pts.length / 6))) verts.push(l.pts[i]);
      for (let i = verts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [verts[i], verts[j]] = [verts[j], verts[i]]; }
      const sample = verts.slice(0, 700);
      const carto = sample.map(([x, y]) => Cesium.Cartographic.fromDegrees(center.lng + x * net.k.lng, center.lat + y * net.k.lat));
      let res = [];
      try { res = await scene.sampleHeightMostDetailed(carto, [peopleBB], 0.5); } catch (e) { console.warn('height sampling failed', e); }
      const grid = new Array(N * N).fill(Infinity);
      res.forEach((c, i) => {
        if (!c || c.height == null || !isFinite(c.height)) return;
        const gx = Math.floor(sample[i][0] / CELL + N / 2), gy = Math.floor(sample[i][1] / CELL + N / 2);
        if (gx < 0 || gy < 0 || gx >= N || gy >= N) return;
        grid[gy * N + gx] = Math.min(grid[gy * N + gx], c.height);
      });
      const known = grid.filter(isFinite).sort((a, b) => a - b);
      const fallback = known.length ? known[Math.floor(known.length / 2)] : (state.groundHeight ?? 0);
      // fill holes from neighbours
      for (let pass = 0; pass < 6; pass++) for (let i = 0; i < grid.length; i++) if (!isFinite(grid[i])) {
        const x = i % N, y = (i / N) | 0; const nb = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && isFinite(grid[yy * N + xx])) nb.push(grid[yy * N + xx]); }
        if (nb.length) grid[i] = Math.min(...nb);
      }
      for (let i = 0; i < grid.length; i++) if (!isFinite(grid[i])) grid[i] = fallback;
      return (x, y) => {
        const gx = clamp(x / CELL + N / 2 - 0.5, 0, N - 1.001), gy = clamp(y / CELL + N / 2 - 0.5, 0, N - 1.001);
        const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
        const a = grid[y0 * N + x0], b = grid[y0 * N + Math.min(x0 + 1, N - 1)], c = grid[Math.min(y0 + 1, N - 1) * N + x0], d = grid[Math.min(y0 + 1, N - 1) * N + Math.min(x0 + 1, N - 1)];
        return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
      };
    }

    function updateTarget(initial) {
      if (!net) return;
      const lp = O.localParts(simNow(), state.utcOffsetSec, state.here?.lng);
      const c = O.crowd({ coverage: state.coverage, walkWeight: net.total, hour: lp.h + lp.m / 60, weather: state.weather, max: 600 });
      state.crowdTarget = c.n;
      $('crowd').textContent = `${c.label} · ~${c.n} walking nearby`;
      $('crowd').title = `Modelled, not tracked: building coverage ${(state.coverage * 100).toFixed(0)}% × local hour × weather`;
      if (initial) while (walkers.length < c.n) walkers.push(spawn());
    }

    function spawn() {
      const r = Math.random() * net.total;
      let lo = 0, hi = net.pick.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (net.pick[mid] < r) lo = mid + 1; else hi = mid; }
      const l = net.lines[lo];
      const umbrella = state.weather && state.weather.rain > 0.2 && Math.random() < 0.8 ? UMBRELLAS[(Math.random() * UMBRELLAS.length) | 0] : null;
      const cloth = CLOTHES[(Math.random() * CLOTHES.length) | 0], skin = SKIN[(Math.random() * SKIN.length) | 0], legs = CLOTHES[(Math.random() * 4) | 0];
      const id = `p-${cloth}-${skin}-${legs}-${umbrella}`;
      const frames = [0, 1].map((f) => ({ id: id + f, make: () => personSprite(cloth, skin, legs, f, umbrella) }));
      const scale = 0.92 + Math.random() * 0.16;
      const bb = peopleBB.add({
        position: Cesium.Cartesian3.ZERO, width: 0.58 * scale, height: 1.72 * scale, sizeInMeters: true,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 260),
      });
      bb.setImage(frames[0].id, frames[0].make());
      return { bb, frames, frame: 0, line: lo, s: Math.random() * l.len, dir: Math.random() < 0.5 ? 1 : -1,
        side: (Math.random() < 0.5 ? -1 : 1) * l.side * (0.75 + Math.random() * 0.5), v: 1.15 + Math.random() * 0.45, pause: 0, phase: Math.random() };
    }

    function turn(p) {
      const l = net.lines[p.line];
      const endPt = p.dir > 0 ? l.pts[l.pts.length - 1] : l.pts[0];
      const opts = (net.nodes.get(net.key(endPt)) || []).filter((o) => o.i !== p.line);
      if (opts.length && Math.random() < 0.9) {
        const o = opts[(Math.random() * opts.length) | 0];
        p.line = o.i; p.dir = o.end === 0 ? 1 : -1; p.s = o.end === 0 ? 0 : net.lines[o.i].len;
        p.side = Math.sign(p.side) * net.lines[o.i].side * (0.75 + Math.random() * 0.5);
      } else { p.dir *= -1; p.side *= -1; }
      if (Math.random() < 0.15) p.pause = 2 + Math.random() * 10;
    }

    function xy(p) {
      const l = net.lines[p.line];
      let i = 1; while (i < l.cum.length - 1 && l.cum[i] < p.s) i++;
      const a = l.pts[i - 1], b = l.pts[i], seg = l.cum[i] - l.cum[i - 1] || 1, t = (p.s - l.cum[i - 1]) / seg;
      const nx = -(b[1] - a[1]) / seg, ny = (b[0] - a[0]) / seg;
      return [lerp(a[0], b[0], t) + nx * p.side, lerp(a[1], b[1], t) + ny * p.side];
    }

    const scratch = new Cesium.Cartesian3();
    function step(dt, now) {
      if (!net || !ground) return;
      for (const p of walkers) {
        if (p.pause > 0) p.pause -= dt;
        else {
          p.s += p.v * dt * p.dir;
          const len = net.lines[p.line].len;
          if (p.s > len || p.s < 0) { p.s = clamp(p.s, 0, len); turn(p); }
          const f = Math.floor(now / 330 + p.phase * 2) % 2;
          if (f !== p.frame) { p.frame = f; p.bb.setImage(p.frames[f].id, p.frames[f].make()); }
        }
        const [x, y] = xy(p);
        p.bb.position = Cesium.Cartesian3.fromDegrees(net.origin.lng + x * net.k.lng, net.origin.lat + y * net.k.lat, ground(x, y), undefined, scratch);
      }
      const target = state.crowdTarget;
      if (walkers.length < target && Math.random() < dt * Math.max(1, (target - walkers.length) * 0.2)) walkers.push(spawn());
      if (walkers.length > target && Math.random() < dt * Math.max(1, (walkers.length - target) * 0.2)) {
        const p = walkers.splice((Math.random() * walkers.length) | 0, 1)[0]; peopleBB.remove(p.bb);
      }
    }
    return { build, clear, step, updateTarget, get origin() { return net?.origin; } };
  })();

  // ---------- going somewhere ----------
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((e) => {
    if (state.mode === 'walk') return;
    let cart = scene.pickPositionSupported ? scene.pickPosition(e.position) : undefined;
    if (!cart) cart = camera.pickEllipsoid(e.position);
    if (!cart) return;
    const c = Cesium.Cartographic.fromCartesian(cart);
    goTo({ lng: c.longitude / DEG, lat: c.latitude / DEG });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  let flight = 0;
  async function goTo(p, name) {
    const id = ++flight;
    exitWalk();
    state.here = p; state.utcOffsetSec = null; state.weather = null;
    people.clear(); precip.set(null);
    $('hint').hidden = true; $('here').hidden = false; $('controls').hidden = false;
    $('place').textContent = name || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    $('wx').textContent = 'loading…';
    history.replaceState(null, '', `${location.search}#${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);
    if (!name) O.placeName(p).then((n) => { if (state.here === p) $('place').textContent = n; }).catch(() => {});

    const wxP = O.fetchWeather(p).then((r) => {
      if (state.here !== p) return r;
      Object.assign(state, { utcOffsetSec: r.utcOffsetSec, tzName: r.tzName, weather: r.weather });
      $('wx').textContent = O.weatherText(r.weather);
      precip.set(r.weather);
      return r;
    }).catch(() => { if (state.here === p) $('wx').textContent = 'weather unavailable'; return null; });

    // 1. fly in to a low aerial view
    const elev = (await Promise.race([wxP, new Promise((r) => setTimeout(r, 2500))]))?.elevation ?? 0;
    if (id !== flight) return;
    $('status').textContent = 'flying in…';
    const heading = Math.random() * 2 * Math.PI;
    await new Promise((res) => camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(p.lng, p.lat, elev + 40), 120),
      { offset: new Cesium.HeadingPitchRange(heading, -35 * DEG, 420), duration: 4, complete: res, cancel: res }));
    if (id !== flight) return;
    state.mode = 'aerial';

    // 2. find street level near the tapped point (lowest surface within ~25 m)
    $('status').textContent = 'finding the street…';
    const k = kDeg(p.lat);
    const ring = [[0, 0]];
    for (const r of [8, 16, 25]) for (let a = 0; a < 8; a++) ring.push([Math.sin(a * Math.PI / 4) * r, Math.cos(a * Math.PI / 4) * r]);
    let best = null;
    try {
      const res = await scene.sampleHeightMostDetailed(ring.map(([x, y]) => Cesium.Cartographic.fromDegrees(p.lng + x * k.lng, p.lat + y * k.lat)), [peopleBB], 0.5);
      res.forEach((c, i) => { if (c && isFinite(c.height) && (!best || c.height < best.h - 0.5 || (Math.abs(c.height - best.h) < 0.5 && Math.hypot(...ring[i]) < Math.hypot(...best.xy)))) best = { h: c.height, xy: ring[i] }; });
    } catch (e) { console.warn(e); }
    if (id !== flight) return;
    const spot = best ? { lng: p.lng + best.xy[0] * k.lng, lat: p.lat + best.xy[1] * k.lat, h: best.h } : { lng: p.lng, lat: p.lat, h: elev };
    state.groundHeight = spot.h;
    people.build(p);

    // 3. drop to eye height and walk
    $('status').textContent = '';
    await new Promise((res) => camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(spot.lng, spot.lat, spot.h + EYE),
      orientation: { heading: camera.heading, pitch: -4 * DEG, roll: 0 }, duration: 2.5, complete: res, cancel: res,
    }));
    if (id !== flight) return;
    enterWalk(spot);
  }

  function backToGlobe() {
    flight++;
    exitWalk();
    state.here = null; state.weather = null; state.mode = 'globe';
    people.clear(); precip.set(null);
    history.replaceState(null, '', location.pathname + location.search);
    $('hint').hidden = false; $('here').hidden = true; $('controls').hidden = true;
    camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(135, 25, 2.2e7), duration: 3 });
  }

  // ---------- walking ----------
  const walk = { lng: 0, lat: 0, h: 0, heading: 0, pitch: 0, keys: new Set(), pad: new Set(), lastProbe: 0, blocked: false, bob: 0 };
  const ctrl = scene.screenSpaceCameraController;

  function enterWalk(spot) {
    Object.assign(walk, { lng: spot.lng, lat: spot.lat, h: spot.h, heading: camera.heading, pitch: -4 * DEG });
    state.mode = 'walk';
    ctrl.enableInputs = false;
    camera.frustum.near = 0.1;
    $('walkpad').hidden = false;
    $('viewToggle').textContent = 'Aerial view';
  }
  function exitWalk() {
    if (state.mode !== 'walk') return;
    state.mode = 'aerial';
    ctrl.enableInputs = true;
    $('walkpad').hidden = true;
    $('viewToggle').textContent = 'Street view';
  }

  // look around by dragging
  let drag = null;
  scene.canvas.addEventListener('pointerdown', (e) => { if (state.mode === 'walk') { drag = { x: e.clientX, y: e.clientY }; scene.canvas.setPointerCapture(e.pointerId); } });
  scene.canvas.addEventListener('pointermove', (e) => {
    if (!drag || state.mode !== 'walk') return;
    walk.heading += (e.clientX - drag.x) * 0.0045;
    walk.pitch = clamp(walk.pitch - (e.clientY - drag.y) * 0.0045, -70 * DEG, 70 * DEG);
    drag = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('keydown', (e) => { if (state.mode === 'walk' && !e.target.closest('input')) { walk.keys.add(e.key.toLowerCase()); if (e.key.startsWith('Arrow')) e.preventDefault(); } });
  addEventListener('keyup', (e) => walk.keys.delete(e.key.toLowerCase()));
  for (const b of document.querySelectorAll('#walkpad button')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); walk.pad.add(k); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => walk.pad.delete(k));
  }

  const down = (k) => walk.keys.has(k) || walk.pad.has(k);
  function probe(fromLng, fromLat, fromH, dirX, dirY, dirZ, maxDist) {
    const origin = Cesium.Cartesian3.fromDegrees(fromLng, fromLat, fromH);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const dir = Cesium.Matrix4.multiplyByPointAsVector(enu, new Cesium.Cartesian3(dirX, dirY, dirZ), new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(dir, dir);
    const hit = scene.pickFromRay(new Cesium.Ray(origin, dir), [peopleBB]);
    if (!hit || !hit.position) return null;
    const d = Cesium.Cartesian3.distance(origin, hit.position);
    return d <= maxDist ? { d, h: Cesium.Cartographic.fromCartesian(hit.position).height } : null;
  }

  function stepWalk(dt, now) {
    if (state.mode !== 'walk') return;
    if (down('arrowleft') || down('q')) walk.heading -= 1.6 * dt;
    if (down('arrowright') || down('e')) walk.heading += 1.6 * dt;
    let f = 0, s = 0;
    if (down('w') || down('arrowup')) f += 1;
    if (down('s') || down('arrowdown')) f -= 1;
    if (down('a')) s -= 1;
    if (down('d')) s += 1;
    const speed = walk.keys.has('shift') ? RUN : WALK;
    const moving = f || s;
    if (moving) {
      const len = Math.hypot(f, s); f /= len; s /= len;
      const h = walk.heading;
      const dx = (Math.sin(h) * f + Math.cos(h) * s) * speed * dt; // east
      const dy = (Math.cos(h) * f - Math.sin(h) * s) * speed * dt; // north
      const k = kDeg(walk.lat);
      // wall check (chest height, 0.7 m ahead), 10 Hz
      if (now - walk.lastProbe > 100) {
        walk.lastProbe = now;
        const n = Math.hypot(dx, dy) || 1;
        walk.blocked = !!probe(walk.lng, walk.lat, walk.h + 1.1, dx / n, dy / n, 0, 0.7);
        // ground under the next step: ray down from just above head height
        const g = probe(walk.lng + dx * 8 * k.lng, walk.lat + dy * 8 * k.lat, walk.h + 2.2, 0, 0, -1, 6);
        if (g && g.h - walk.h < 0.6) walk.targetH = g.h;
      }
      if (!walk.blocked) { walk.lng += dx * k.lng; walk.lat += dy * k.lat; }
      if (walk.targetH != null) walk.h = lerp(walk.h, walk.targetH, clamp(dt * 6, 0, 1));
      walk.bob += dt * speed * 5.5;
    }
    const bob = moving ? Math.sin(walk.bob) * 0.025 : 0;
    camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(walk.lng, walk.lat, walk.h + EYE + bob),
      orientation: { heading: walk.heading, pitch: walk.pitch, roll: 0 },
    });
  }

  $('viewToggle').addEventListener('click', () => {
    if (!state.here) return;
    if (state.mode === 'walk') {
      exitWalk();
      camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(walk.lng, walk.lat, walk.h), 60),
        { offset: new Cesium.HeadingPitchRange(walk.heading, -40 * DEG, 260), duration: 2 });
    } else {
      const c = Cesium.Cartographic.fromCartesian(camera.positionWC);
      // drop down to the street under the centre of the view
      const centre = scene.pickPosition(new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2));
      const target = centre ? Cesium.Cartographic.fromCartesian(centre) : c;
      goTo({ lng: target.longitude / DEG, lat: target.latitude / DEG }, $('place').textContent);
    }
  });

  // ---------- precipitation, sun, clock ----------
  const precip = O.makePrecip(() => camera.heading / DEG);

  function renderClock() {
    if (!state.here) return;
    const lp = O.localParts(simNow(), state.utcOffsetSec, state.here.lng);
    $('clock').textContent = `${pad(lp.h)}:${pad(lp.m)}:${pad(lp.s)}`;
    const dateStr = lp.d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    $('date').textContent = `${dateStr} · ${state.utcOffsetSec != null ? state.tzName : 'approx. time zone'}${state.shiftHours ? ' · shifted' : ''}`;
  }
  function applySky() {
    const s = state.here ? O.sun(simNow(), state.here) : { alt: 30 };
    const o = O.applyOverlays({ sunAlt: s.alt, weather: state.weather, active: !!state.here, canvas: scene.canvas });
    if (state.here) $('sun').textContent = O.sunText(s);
    // dynamic shadows only make sense with direct sun
    scene.shadowMap.enabled = !!state.here && s.alt > 1 && o.cloud < 0.85 && o.fogAmt < 0.6;
    scene.shadowMap.darkness = lerp(0.6, 0.35, o.cloud);
  }

  const shift = $('shift');
  shift.addEventListener('input', () => {
    state.shiftHours = parseFloat(shift.value);
    $('shiftLabel').textContent = state.shiftHours === 0 ? 'live' : `${state.shiftHours > 0 ? '+' : ''}${state.shiftHours} h (weather stays live)`;
    renderClock(); applySky(); people.updateTarget(false);
  });
  $('live').addEventListener('click', () => { shift.value = 0; shift.dispatchEvent(new Event('input')); });
  $('globe').addEventListener('click', backToGlobe);
  for (const p of O.PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name;
    b.addEventListener('click', () => goTo({ lng: p.lng, lat: p.lat }, p.name));
    $('presets').appendChild(b);
  }
  setInterval(() => people.updateTarget(false), 5000);
  setInterval(async () => {
    if (!state.here || !state.weather || Date.now() - state.weather.fetched < 600e3) return;
    const p = state.here;
    try { const r = await O.fetchWeather(p); if (state.here === p) { state.weather = r.weather; $('wx').textContent = O.weatherText(r.weather); precip.set(r.weather); } } catch { /* keep last */ }
  }, 30e3);

  // ---------- main loop ----------
  let last = performance.now(), lastSec = 0, frames = 0, fpsT = last;
  scene.preRender.addEventListener(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(simNow());
    stepWalk(dt, now);
    people.step(dt, now);
    precip.step(dt, now, !!state.here);
    if (now - lastSec > 1000) { lastSec = now; renderClock(); applySky(); }
    frames++;
    if (now - fpsT > 1000) { $('fps').textContent = `${Math.round(frames * 1000 / (now - fpsT))} fps`; frames = 0; fpsT = now; }
  });

  const m = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) goTo({ lat: +m[1], lng: +m[2] });

  window.__oneMinute = { viewer, state, goTo, people };
})();
