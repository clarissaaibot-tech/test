/* Seat View engine: seat map + 3D "view from your seat" + booking ticket.
   A venue page calls SeatView(config). See any venue folder for a full config. */
(function () {
  const BACK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3 5 8l5 5"/></svg>';
  const GRID_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>';

  function rng(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  window.SeatView = function (cfg) {
    const app = document.getElementById('app');
    const T = THREE;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tiers = cfg.tiers || { std: 'Standard', prem: 'Premium' };
    const mapH = 100 / cfg.map.aspect;

    app.innerHTML = `
<div class="stage"><div class="phone">
  <section class="view" data-v="map" aria-hidden="false" aria-label="Choose a seat">
    <header class="top">
      <a class="icon-btn" href="../" aria-label="All venues">${BACK_ICON}</a>
      <div class="title"><h1>${cfg.title}</h1><p>${cfg.subtitle}</p></div>
      <a class="icon-btn" href="../" aria-label="All venues">${GRID_ICON}</a>
    </header>
    <div class="times" role="group" aria-label="${cfg.optionsLabel || 'Session'}"></div>
    <div class="map-wrap">
      <div class="map-box"><div class="map" style="--aspect:${cfg.map.aspect}">
        <svg class="decor" viewBox="0 0 100 ${mapH}" preserveAspectRatio="none" aria-hidden="true">${cfg.map.decor}</svg>
      </div></div>
      <div class="legend">
        <span><i></i>${tiers.std}</span>${tiers.prem ? `<span><i class="prem"></i>${tiers.prem}</span>` : ''}
        <span><i class="taken"></i>Taken</span><span><i class="sel"></i>Selected</span>
      </div>
      <p class="hint">${cfg.hint || 'Tap a seat to see the view from it.'}</p>
    </div>
    <footer class="bar">
      <div class="sum"><small data-k="sumLabel">Choose your seat</small><strong data-k="sumPrice">—</strong></div>
      <button class="btn primary" data-k="openView" disabled>View from seat</button>
    </footer>
  </section>
  <section class="view" data-v="seat" aria-hidden="true" aria-label="View from seat">
    <canvas class="gl" aria-label="3D preview of the view from the chosen seat. Drag to look around."></canvas>
    <div class="v-top">
      <button class="icon-btn" data-k="back" aria-label="Back to seat map">${BACK_ICON}</button>
      <div class="pill" data-k="pill"></div><span></span>
    </div>
    <div class="drag" data-k="drag">Drag to look around</div>
    <div class="sheet">
      <div class="handle"></div>
      <div class="sheet-head">
        <div><div class="eyebrow" data-k="verdict"></div><h2 data-k="name"></h2><p class="sub" data-k="sub"></p></div>
        <div class="mini" aria-hidden="true"><svg viewBox="0 0 100 ${mapH}" data-k="mini"></svg></div>
      </div>
      <p class="note" data-k="note"></p>
      <div class="stats" data-k="stats"></div>
      <div class="actions">
        <button class="btn ghost" data-k="change">Change seat</button>
        <button class="btn light" data-k="book">Book</button>
      </div>
    </div>
  </section>
  <section class="view ticket-view" data-v="ticket" aria-hidden="true" aria-label="Booking confirmed">
    <div class="ticket">
      <div class="t-top"><div class="eyebrow" data-k="tEyebrow">Booked</div><h3 data-k="tTitle"></h3><p data-k="tWhen"></p></div>
      <div class="t-grid" data-k="tGrid"></div>
      <div class="t-code"><div class="bars"></div><b data-k="tCode"></b></div>
    </div>
    <p class="done-note">${cfg.doneNote || 'Your seat now shows as yours on the map. Show this code at the door.'}</p>
    <button class="btn primary" data-k="done">Back to seat map</button>
  </section>
</div></div>`;

    const K = k => app.querySelector(`[data-k="${k}"]`);
    const V = v => app.querySelector(`[data-v="${v}"]`);
    const times = app.querySelector('.times'), mapEl = app.querySelector('.map');
    const seats = cfg.seats;
    seats.forEach((s, i) => s.i = i);
    let opt = cfg.defaultOption || 0, sel = null;
    const mine = cfg.options.map(() => new Set());
    const taken = cfg.options.map(o => {
      const r = rng(o.seed || 7), set = new Set();
      seats.forEach(s => { if (r() < (cfg.takenProb ? cfg.takenProb(s, o) : 0.35)) set.add(s.i); });
      return set;
    });
    const isTaken = s => taken[opt].has(s.i) || mine[opt].has(s.i);
    const price = s => cfg.price(s, cfg.options[opt]);
    const cur = cfg.currency || '€';
    const money = v => v === 0 ? 'Included' : cur + v.toFixed(2);

    // ---------- map ----------
    cfg.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.innerHTML = `${o.label}${o.tag ? `<small>${o.tag}</small>` : ''}`;
      b.onclick = () => { opt = i; sel = null; renderTimes(); renderMap(); if (hooks.setOption) hooks.setOption(cfg.options[opt], opt); paint(); };
      times.appendChild(b);
    });
    function renderTimes() { [...times.children].forEach((b, i) => b.setAttribute('aria-pressed', i === opt)); }
    const btns = seats.map(s => {
      const b = document.createElement('button');
      const size = s.ms || cfg.map.seat;
      b.style.left = s.mx + '%'; b.style.top = (s.my / mapH * 100) + '%';
      b.style.width = size + '%'; b.style.height = (size / mapH * 100 * (s.mhr || 1)) + '%';
      if (s.mr) b.style.setProperty('--r', s.mr + 'deg');
      b.onclick = () => { if (b.disabled) return; sel = s; renderMap(); openSeat(); };
      mapEl.appendChild(b);
      return b;
    });
    function renderMap() {
      seats.forEach((s, i) => {
        const b = btns[i], own = mine[opt].has(i), tk = taken[opt].has(i);
        b.className = 'seat' + (s.tier === 'prem' ? ' prem' : '') + (tk ? ' taken' : '') + (own ? ' mine' : '') + (sel === s ? ' sel' : '');
        b.disabled = tk || own;
        b.setAttribute('aria-label', `${s.name}, ${s.tier === 'prem' ? tiers.prem : tiers.std}, ${own ? 'booked by you' : tk ? 'taken' : money(price(s))}`);
      });
      K('sumLabel').textContent = sel ? sel.name : 'Choose your seat';
      K('sumPrice').textContent = sel ? money(price(sel)) : '—';
      K('openView').disabled = !sel;
    }

    // ---------- 3D ----------
    const canvas = app.querySelector('canvas');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(80, 1, 0.05, 600);
    const lib = {
      T, scene, camera, renderer,
      mat: (color, o = {}) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.9 }, o)),
      basic: (color, o = {}) => new T.MeshBasicMaterial(Object.assign({ color }, o)),
      box(w, h, d, mat, x, y, z, parent) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; },
      canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; },
      rng,
    };
    const hooks = cfg.build(lib, cfg.options[opt], opt) || {};

    // chairs and people
    const ch = Object.assign({ w: 0.5, seatH: 0.42, backH: 0.66, backTilt: -0.16, color: 0x7a141c, prem: 0x601017, premScale: 1.12, arms: true, armColor: 0x241517 }, cfg.chair || {});
    const N = seats.length;
    const velvet = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
    const cushion = new T.InstancedMesh(new T.BoxGeometry(ch.w, 0.16, 0.5), velvet, N);
    const back = new T.InstancedMesh(new T.BoxGeometry(ch.w + 0.04, ch.backH, 0.13), velvet, N);
    const arms = new T.InstancedMesh(new T.BoxGeometry(0.07, 0.1, 0.5), lib.mat(ch.armColor, { roughness: 0.6 }), ch.arms ? N * 2 : 1);
    const skin = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const heads = new T.InstancedMesh(new T.SphereGeometry(0.1, 14, 10), skin, N);
    const torsos = new T.InstancedMesh(new T.BoxGeometry(0.42, 0.36, 0.24), skin, N);
    [cushion, back, arms, heads, torsos].forEach(m => scene.add(m));
    const D = new T.Object3D(), up = new T.Vector3(0, 1, 0);
    const local = (s, x, y, z) => new T.Vector3(x, y, z).applyAxisAngle(up, s.rot || 0).add(new T.Vector3(s.x, s.y, s.z));
    const place = (mesh, idx, s, lx, ly, lz, tilt = 0, sx = 1, sy = 1, sz = 1) => {
      D.position.copy(local(s, lx, ly, lz)); D.rotation.set(tilt, s.rot || 0, 0, 'YXZ'); D.scale.set(sx, sy, sz); D.updateMatrix(); mesh.setMatrixAt(idx, D.matrix);
    };
    seats.forEach(s => {
      const sc = s.tier === 'prem' ? ch.premScale : 1;
      place(cushion, s.i, s, 0, ch.seatH, 0, 0, sc, 1, sc);
      place(back, s.i, s, 0, ch.seatH + ch.backH / 2 - 0.05, 0.27 * sc, ch.backTilt, sc, 1, 1);
      if (ch.arms) { place(arms, s.i * 2, s, -(ch.w / 2 + 0.05) * sc, ch.seatH + 0.2, 0, 0, 1, 1, sc); place(arms, s.i * 2 + 1, s, (ch.w / 2 + 0.05) * sc, ch.seatH + 0.2, 0, 0, 1, 1, sc); }
    });
    if (!ch.arms) { D.scale.set(0, 0, 0); D.updateMatrix(); arms.setMatrixAt(0, D.matrix); }
    const C_STD = new T.Color(ch.color), C_PREM = new T.Color(ch.prem), C_SEL = new T.Color(0xf3b33d);
    const tones = (cfg.people || [0x1a1212, 0x221a16, 0x15151b, 0x2a2420, 0x1b1d17]).map(c => new T.Color(c));
    const hide = new T.Matrix4().makeScale(0, 0, 0);
    function paint() {
      seats.forEach(s => {
        const on = sel === s;
        const col = on ? C_SEL : s.tier === 'prem' ? C_PREM : C_STD;
        cushion.setColorAt(s.i, col); back.setColorAt(s.i, col);
        if (isTaken(s) && !on) {
          const v = (s.i * 7919) % 97 / 97, tall = (v - 0.5) * 0.12, sway = ((s.i * 31) % 5 - 2) * 0.02;
          place(heads, s.i, s, sway, ch.seatH + 0.83 + tall, 0.1, 0, 1, 1.15, 1);
          place(torsos, s.i, s, 0, ch.seatH + 0.45 + tall, 0.12);
          const tc = tones[s.i % tones.length];
          torsos.setColorAt(s.i, tc); heads.setColorAt(s.i, new T.Color(0x2a1d17).lerp(new T.Color(0x0c0808), v));
        } else { heads.setMatrixAt(s.i, hide); torsos.setMatrixAt(s.i, hide); torsos.setColorAt(s.i, tones[0]); heads.setColorAt(s.i, tones[0]); }
      });
      [cushion, back, heads, torsos, arms].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    }

    // camera rig
    const V3 = a => new T.Vector3(a[0], a[1], a[2]);
    const pose0 = cfg.overview;
    const cam = { pos: V3(pose0.pos), look: V3(pose0.look) };
    let from = null, to = null, t0 = 0, yaw = 0, pitch = 0, active = false, dragging = false;
    const DUR = 1400;
    function seatPose(s) {
      const p = cfg.pose ? cfg.pose(s, cfg.options[opt]) : null;
      if (p) return { pos: V3(p.pos), look: V3(p.look) };
      return { pos: local(s, 0, ch.seatH + 0.86, 0.3), look: V3(cfg.focus) };
    }
    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const portrait = w / h < 0.6;
      camera.fov = portrait ? (cfg.fovPortrait || 104) : (cfg.fovWide || 84);
      // the info sheet covers the lower part of the screen; shift the optical centre upward
      camera.setViewOffset(w, h * 1.45, 0, h * 0.45, w, h);
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(canvas);
    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!active) return;
      if (from) {
        const k = Math.min(1, (now - t0) / DUR), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        cam.pos.lerpVectors(from.pos, to.pos, e); cam.look.lerpVectors(from.look, to.look, e);
        if (k === 1) from = null;
      }
      if (!dragging) { yaw *= 0.95; pitch *= 0.95; }
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
      camera.rotateY(yaw); camera.rotateX(pitch);
      if (hooks.tick) hooks.tick(now / 1000, dt);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
    let lx = 0, ly = 0;
    const lim = cfg.look || { yaw: 0.8, pitch: 0.4 };
    canvas.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); K('drag').style.opacity = 0; });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      yaw = Math.max(-lim.yaw, Math.min(lim.yaw, yaw + (e.clientX - lx) * 0.004));
      pitch = Math.max(-lim.pitch, Math.min(lim.pitch, pitch + (e.clientY - ly) * 0.003));
      lx = e.clientX; ly = e.clientY;
    });
    ['pointerup', 'pointercancel'].forEach(ev => canvas.addEventListener(ev, () => { dragging = false; }));

    // ---------- views ----------
    function show(which) {
      ['map', 'seat', 'ticket'].forEach(v => V(v).setAttribute('aria-hidden', v !== which));
      active = which === 'seat';
      if (active) resize();
    }
    function mini(s) {
      let out = cfg.map.miniDecor || '';
      seats.forEach(o => { if (o !== s) out += `<circle cx="${o.mx}" cy="${o.my}" r="${(cfg.map.seat * 0.42).toFixed(2)}" fill="#3a2f30"/>`; });
      out += `<circle cx="${s.mx}" cy="${s.my}" r="${Math.max(2.4, cfg.map.seat * 0.9)}" fill="#f3b33d"/>`;
      K('mini').innerHTML = out;
    }
    function openSeat() {
      if (!sel) return;
      const s = sel, o = cfg.options[opt], m = cfg.metrics(s, o);
      paint();
      if (!active) { const p = cfg.approach ? cfg.approach(s, o) : pose0; cam.pos.copy(V3(p.pos)); cam.look.copy(V3(p.look)); }
      yaw = pitch = 0;
      show('seat');
      from = { pos: cam.pos.clone(), look: cam.look.clone() }; to = seatPose(s); t0 = performance.now();
      if (reduce) { cam.pos.copy(to.pos); cam.look.copy(to.look); from = null; }
      K('pill').textContent = `View from ${s.short}`;
      K('verdict').textContent = m.verdict;
      K('name').textContent = s.name;
      K('sub').textContent = `${s.tier === 'prem' ? tiers.prem : tiers.std} · ${o.label}${o.tag ? ' ' + o.tag : ''} · ${money(price(s))}`;
      K('note').textContent = m.note;
      K('stats').innerHTML = m.stats.map(([v, l]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join('');
      K('book').textContent = `${cfg.bookVerb || 'Book'} · ${money(price(s))}`;
      mini(s);
      K('drag').style.opacity = 1;
    }
    K('openView').onclick = openSeat;
    K('back').onclick = K('change').onclick = () => show('map');
    K('book').onclick = () => {
      const s = sel, o = cfg.options[opt];
      mine[opt].add(s.i);
      const code = (cfg.codePrefix || 'SV') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const t = cfg.ticket(s, o);
      K('tEyebrow').textContent = t.eyebrow || 'Booked';
      K('tTitle').textContent = t.title; K('tWhen').textContent = t.when;
      K('tGrid').innerHTML = t.fields.concat([['Paid', money(price(s))]]).slice(0, 3).map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
      K('tCode').textContent = code;
      sel = null; renderMap(); show('ticket');
    };
    K('done').onclick = () => show('map');

    renderTimes(); renderMap(); paint();
    return { scene, camera, lib };
  };
})();
