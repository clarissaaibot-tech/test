/* One Minute Anywhere
 *
 * Tap a point on Earth and stand there:
 *  - local time comes from that point's time zone (Open-Meteo returns the UTC offset)
 *  - sun position is computed with SunCalc and drives the 3D light, the sky tint
 *    and building shadows projected on the ground
 *  - weather is the live "current" reading from Open-Meteo (fog, rain, snow, storms)
 *  - pedestrians are a model, not tracking: crowd size comes from how built-up the
 *    area is (OSM building coverage), the local hour and the weather, and they walk
 *    the real OSM street / footpath network.
 */
(() => {
  'use strict';

  const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  const DEG = Math.PI / 180;
  const M_PER_DEG_LAT = 111320;

  const PRESETS = [
    { name: 'Shibuya, Tokyo', lng: 139.7005, lat: 35.6595 },
    { name: 'Gion, Kyoto', lng: 135.7752, lat: 35.0037 },
    { name: 'Okinawa coast', lng: 127.9786, lat: 26.6943 },
    { name: 'Times Square', lng: -73.9855, lat: 40.758 },
    { name: 'Paris', lng: 2.3488, lat: 48.8534 },
    { name: 'Reykjavík', lng: -21.9333, lat: 64.1466 },
  ];

  // ---------- state ----------
  const state = {
    here: null,            // {lng, lat}
    utcOffsetSec: null,    // from weather API
    tzName: '',
    weather: null,         // parsed weather object
    shiftHours: 0,
    lastShadowSunKey: '',
    crowdTarget: 0,
    coverage: 0,
  };

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a) => a == null ? `rgb(${c.map(Math.round).join(',')})` : `rgba(${c.map(Math.round).join(',')},${a})`;
  const simNow = () => new Date(Date.now() + state.shiftHours * 3600e3);
  const pad = (n) => String(n).padStart(2, '0');

  function localParts(date) {
    const off = state.utcOffsetSec != null ? state.utcOffsetSec : Math.round((state.here?.lng || 0) / 15) * 3600;
    const d = new Date(date.getTime() + off * 1000); // read with UTC getters
    return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), d };
  }

  function metersToDeg(lat) {
    return { lat: 1 / M_PER_DEG_LAT, lng: 1 / (M_PER_DEG_LAT * Math.cos(lat * DEG)) };
  }

  function distM(a, b) {
    const k = metersToDeg((a.lat + b.lat) / 2);
    return Math.hypot((a.lng - b.lng) / k.lng, (a.lat - b.lat) / k.lat);
  }

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: 'map',
    style: STYLE_URL,
    center: [135, 25],
    zoom: 1.6,
    maxPitch: 78,
    attributionControl: false,
    canvasContextAttributes: { antialias: true },
  });

  let you = null;
  let styleReady = false;

  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    styleReady = true;

    // ground shadows sit above roads/landuse, below 3D buildings
    map.addSource('shadows', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'shadows', type: 'fill', source: 'shadows',
      paint: { 'fill-color': '#1e2340', 'fill-opacity': 0, 'fill-antialias': false },
    }, 'building-3d');

    // pedestrians: drawn before building-3d so buildings occlude them
    map.addSource('people', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'people', type: 'circle', source: 'people', minzoom: 14,
      paint: {
        'circle-color': ['get', 'c'],
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 1.2, 17, 3.4, 19, 9, 21, 24],
        'circle-pitch-scale': 'map',
        'circle-pitch-alignment': 'map',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 16, 0, 18, 0.8],
        'circle-stroke-color': 'rgba(0,0,0,0.35)',
      },
    }, 'building-3d');

    map.setPaintProperty('building-3d', 'fill-extrusion-vertical-gradient', true);
    // street-level view: drop shop/POI icons so the street itself reads
    for (const l of map.getStyle().layers) if (/^poi_|road_one_way/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none');
    applySunAndSky(true);
  });

  map.on('click', (e) => {
    goTo({ lng: e.lngLat.lng, lat: e.lngLat.lat });
  });

  map.on('moveend', () => {
    scheduleShadows();
    maybeRebuildNetwork();
  });
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) { scheduleShadows(); maybeRebuildNetwork(); }
  });

  // ---------- going somewhere ----------
  async function goTo(p, name) {
    const far = !state.here || distM(state.here, p) > 3000;
    state.here = p;
    if (!you) {
      const el = document.createElement('div'); el.className = 'you';
      you = new maplibregl.Marker({ element: el });
    }
    you.setLngLat([p.lng, p.lat]).addTo(map);

    $('hint').hidden = true;
    $('here').hidden = false;
    $('controls').hidden = false;
    $('place').textContent = name || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    history.replaceState(null, '', `#${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);

    if (far) {
      state.utcOffsetSec = null;
      state.weather = null;
      $('wx').textContent = 'loading…';
      people.reset();
      map.flyTo({
        center: [p.lng, p.lat], zoom: 17.3, pitch: 66,
        bearing: Math.round(Math.random() * 360), duration: 4000, essential: true,
      });
      if (!name) reverseGeocode(p);
    } else {
      map.easeTo({ center: [p.lng, p.lat], duration: 900 });
    }
    if (far) await loadWeather(p);
  }

  function backToGlobe() {
    if (you) you.remove();
    history.replaceState(null, '', location.pathname);
    state.here = null;
    people.reset();
    setShadowData(emptyFC());
    $('hint').hidden = false; $('here').hidden = true; $('controls').hidden = true;
    state.weather = null;
    precip.set(null);
    applySunAndSky(true);
    map.flyTo({ center: [135, 25], zoom: 1.6, pitch: 0, bearing: 0, duration: 3000 });
  }

  async function reverseGeocode(p) {
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${p.lat}&longitude=${p.lng}&localityLanguage=en`);
      const j = await r.json();
      if (state.here !== p) return;
      const parts = [j.locality, j.city !== j.locality ? j.city : null, j.countryName].filter(Boolean);
      if (parts.length) $('place').textContent = parts.join(', ');
      else if (!j.countryName) $('place').textContent = `Open water · ${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`;
    } catch { /* keep coordinates */ }
  }

  // ---------- weather ----------
  const WMO = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
  };
  const RAIN_LEVEL = { 51: .15, 53: .25, 55: .35, 56: .2, 57: .3, 61: .4, 63: .65, 65: 1, 66: .4, 67: .7, 80: .45, 81: .7, 82: 1, 95: .9, 96: 1, 99: 1 };
  const SNOW_LEVEL = { 71: .35, 73: .65, 75: 1, 77: .3, 85: .5, 86: .9 };

  async function loadWeather(p) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(4) + '&longitude=' + p.lng.toFixed(4) +
      '&current=temperature_2m,apparent_temperature,weather_code,cloud_cover,visibility,precipitation,wind_speed_10m,wind_direction_10m,is_day' +
      '&timezone=auto';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        if (state.here !== p) return;
        const c = j.current;
        const code = c.weather_code;
        const vis = c.visibility ?? 20000;
        let fog = clamp(1 - Math.log10(Math.max(vis, 100) / 150) / Math.log10(20000 / 150), 0, 1);
        if (code === 45 || code === 48) fog = Math.max(fog, 0.65);
        state.utcOffsetSec = j.utc_offset_seconds;
        state.tzName = j.timezone_abbreviation || j.timezone;
        state.weather = {
          code, label: WMO[code] || `Code ${code}`, temp: c.temperature_2m, feels: c.apparent_temperature,
          cloud: (c.cloud_cover ?? 0) / 100, vis, fog,
          rain: Math.max(RAIN_LEVEL[code] || 0, clamp((c.precipitation || 0) / 4, 0, 1) * (SNOW_LEVEL[code] ? 0 : 1)),
          snow: SNOW_LEVEL[code] || 0,
          thunder: code >= 95,
          wind: c.wind_speed_10m || 0, windDir: c.wind_direction_10m || 0,
          fetched: Date.now(),
        };
        renderWeather();
        precip.set(state.weather);
        applySunAndSky(true);
        return;
      } catch (err) {
        await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
      }
    }
    if (state.here === p) $('wx').textContent = 'weather unavailable';
  }

  function renderWeather() {
    const w = state.weather; if (!w) return;
    const visTxt = w.vis < 1000 ? `${Math.round(w.vis)} m` : `${(w.vis / 1000).toFixed(w.vis < 10000 ? 1 : 0)} km`;
    $('wx').textContent = `${w.label}, ${Math.round(w.temp)}°C · visibility ${visTxt} · wind ${Math.round(w.wind)} km/h`;
  }

  // refresh weather every 10 minutes while standing somewhere
  setInterval(() => { if (state.here && state.weather && Date.now() - state.weather.fetched > 600e3) loadWeather(state.here); }, 30e3);

  // ---------- sun, light, sky, tint ----------
  function sunInfo() {
    if (!state.here) return { alt: 30, bearing: 160 };
    const pos = SunCalc.getPosition(simNow(), state.here.lat, state.here.lng);
    // SunCalc azimuth: 0 = south, positive toward west. Convert to compass bearing.
    return { alt: pos.altitude / DEG, bearing: (pos.azimuth / DEG + 180 + 360) % 360 };
  }

  const NIGHT = [74, 88, 150], TWILIGHT = [150, 138, 190], GOLDEN = [255, 196, 150], DAY = [255, 255, 255];

  function tintFor(alt) {
    if (alt < -8) return NIGHT;
    if (alt < -2) return mix3(NIGHT, TWILIGHT, smooth(-8, -2, alt));
    if (alt < 4) return mix3(TWILIGHT, GOLDEN, smooth(-2, 4, alt));
    if (alt < 14) return mix3(GOLDEN, DAY, smooth(4, 14, alt));
    return DAY;
  }

  function applySunAndSky(force) {
    if (!styleReady) return;
    const sun = sunInfo();
    const w = state.weather;
    const cloud = w ? w.cloud : 0;
    const day = smooth(-6, 6, sun.alt);

    // 3D light from the real sun direction (polar 0 = overhead)
    const polar = sun.alt > 0 ? clamp(90 - sun.alt, 5, 88) : 30;
    const lightColor = sun.alt > 0 ? rgb(mix3(GOLDEN, DAY, smooth(2, 18, sun.alt))) : '#9fb3ff';
    map.setLight({
      anchor: 'map', position: [1.15, sun.bearing, polar], color: lightColor,
      intensity: lerp(0.25, lerp(0.75, 0.5, cloud), day),
    });

    // screen tint (multiply): night blue, twilight violet, golden hour orange; overcast greys it out
    let tint = tintFor(sun.alt);
    if (!state.here) tint = DAY;
    tint = mix3(tint, mix3(tint, [205, 208, 215], 1), cloud * 0.5 * day);
    if (w && (w.rain > 0.5 || w.thunder)) tint = mix3(tint, [170, 175, 190], 0.4 * day);
    $('tint').style.backgroundColor = rgb(tint);
    map.getCanvas().style.filter = state.here ? `saturate(${(1 - cloud * 0.35 * day - (1 - day) * 0.3).toFixed(2)})` : '';

    // sky colours (visible at high pitch)
    const skyDay = mix3([120, 170, 235], [190, 196, 206], cloud);
    const sky = sun.alt > -2 ? mix3([60, 50, 110], skyDay, smooth(-2, 12, sun.alt)) : mix3([8, 12, 30], [60, 50, 110], smooth(-12, -2, sun.alt));
    const horizon = mix3(sky, sun.alt > -4 && sun.alt < 10 ? [255, 170, 120] : [230, 235, 245], sun.alt > -4 && sun.alt < 10 ? 0.6 : 0.35 * day);
    try {
      map.setSky({
        'sky-color': rgb(sky), 'horizon-color': rgb(horizon), 'fog-color': rgb(horizon),
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5, 'atmosphere-blend': state.here ? 0 : 0.8,
      });
    } catch { /* older engines */ }

    // fog overlay coloured by ambient light
    const fogAmt = w ? w.fog : 0;
    const fogCol = mix3([40, 46, 62], [222, 226, 232], day);
    const fogEl = $('fog');
    fogEl.style.background = `linear-gradient(to bottom, ${rgb(fogCol, Math.min(0.97, fogAmt * 1.05))} 0%, ${rgb(fogCol, fogAmt * 0.9)} 35%, ${rgb(fogCol, fogAmt * 0.45)} 100%)`;
    fogEl.style.opacity = fogAmt > 0.02 && state.here ? 1 : 0;

    // shadows: recompute when the sun moved enough
    const key = `${sun.alt.toFixed(1)}|${sun.bearing.toFixed(1)}|${cloud.toFixed(2)}`;
    if (force || key !== state.lastShadowSunKey) { state.lastShadowSunKey = key; scheduleShadows(); }
    const shadowOpacity = 0.34 * smooth(1, 10, sun.alt) * (1 - cloud * 0.8) * (1 - fogAmt * 0.7);
    map.setPaintProperty('shadows', 'fill-opacity', shadowOpacity);

    // sun line in the panel
    if (state.here) {
      const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(sun.bearing / 45) % 8];
      const phase = sun.alt > 6 ? 'up' : sun.alt > 0 ? 'low, golden hour' : sun.alt > -6 ? 'just set / twilight' : sun.alt > -18 ? 'below horizon, dusk light' : 'night';
      $('sun').textContent = `${sun.alt.toFixed(1)}° ${compass} · ${phase}`;
    }
  }

  // ---------- shadows ----------
  let shadowTimer = 0;
  function scheduleShadows() {
    clearTimeout(shadowTimer);
    shadowTimer = setTimeout(computeShadows, 120);
  }
  function setShadowData(fc) { const s = map.getSource('shadows'); if (s) s.setData(fc); }

  function computeShadows() {
    if (!state.here || map.getZoom() < 14.5 || !map.getSource('openmaptiles')) { setShadowData(emptyFC()); return; }
    const sun = sunInfo();
    if (sun.alt < 1) { setShadowData(emptyFC()); return; }
    const c = map.getCenter();
    const k = metersToDeg(c.lat);
    const tanAlt = Math.tan(sun.alt * DEG);
    const away = (sun.bearing + 180) * DEG; // shadows fall away from the sun
    const ux = Math.sin(away), uy = Math.cos(away);
    const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
    const out = [];
    const seen = new Set();
    for (const f of feats) {
      const h = f.properties.render_height || 0;
      if (h < 2) continue;
      const len = Math.min(h / tanAlt, 900);
      const dx = ux * len * k.lng, dy = uy * len * k.lat;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      for (const poly of polys) {
        const ring = poly[0];
        if (!ring || ring.length < 3) continue;
        const sig = ring[0][0].toFixed(6) + ring[0][1].toFixed(6) + ring.length;
        if (seen.has(sig)) continue; seen.add(sig);
        if (Math.abs(ring[0][0] - c.lng) / k.lng > 900 || Math.abs(ring[0][1] - c.lat) / k.lat > 900) continue;
        const pts = [];
        for (const p of ring) { pts.push(p); pts.push([p[0] + dx, p[1] + dy]); }
        const hull = convexHull(pts);
        if (out.length > 6000) break;
        if (hull.length >= 3) { hull.push(hull[0]); out.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [hull] } }); }
      }
    }
    setShadowData({ type: 'FeatureCollection', features: out });
  }

  function convexHull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

  // ---------- people ----------
  // Walkable OSM classes, weighted by how much foot traffic they tend to carry,
  // and the sideways offset (m) from the centreline where the sidewalk would be.
  const WALK = {
    path: { w: 3.0, side: 0.6 }, minor: { w: 1.4, side: 3.5 }, tertiary: { w: 1.8, side: 5.5 },
    secondary: { w: 2.0, side: 7 }, primary: { w: 2.0, side: 9 }, service: { w: 0.5, side: 2 },
    track: { w: 0.2, side: 1 }, pedestrian: { w: 3.5, side: 2 },
  };
  const CLOTHES = ['#2b2d33', '#3d4a66', '#6b3a3a', '#e8e4dc', '#9aa3ad', '#1f3b2d', '#c9a227', '#b5462f', '#4d6fa8', '#f2f2f2', '#5a4632', '#202020'];
  const UMBRELLAS = ['#1b1b1b', '#24324f', '#7d1f2b', '#e7e7e7', '#2f5f8a'];

  const people = (() => {
    let net = null;   // { origin:{lng,lat}, k, lines:[{pts:[[x,y]], cum:[], len, side}], nodes:Map, pick:[] }
    let walkers = [];
    let lastPush = 0;

    function reset() { net = null; walkers = []; const s = map.getSource('people'); if (s) s.setData(emptyFC()); $('crowd').textContent = '—'; }

    function build(center) {
      const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' });
      const k = metersToDeg(center.lat);
      const R = 650;
      const lines = [];
      const seen = new Set();
      for (const f of feats) {
        const p = f.properties;
        if (p.brunnel === 'tunnel') continue;
        const cls = (p.class === 'path' && (p.subclass === 'pedestrian' || p.subclass === 'footway')) ? (p.subclass === 'pedestrian' ? 'pedestrian' : 'path') : p.class;
        const spec = WALK[cls]; if (!spec) continue;
        const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
        for (const coords of parts) {
          if (coords.length < 2) continue;
          const sig = coords[0][0].toFixed(6) + coords[0][1].toFixed(6) + coords[coords.length - 1][0].toFixed(6);
          if (seen.has(sig)) continue; seen.add(sig);
          const pts = coords.map(([lng, lat]) => [(lng - center.lng) / k.lng, (lat - center.lat) / k.lat]);
          if (!pts.some(([x, y]) => x * x + y * y < R * R)) continue;
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const len = cum[cum.length - 1];
          if (len < 3) continue;
          lines.push({ pts, cum, len, side: spec.side, w: spec.w * len });
        }
      }
      // endpoint graph so walkers can turn onto connected streets
      const nodes = new Map();
      const key = ([x, y]) => `${Math.round(x)},${Math.round(y)}`;
      lines.forEach((l, i) => {
        for (const [end, pt] of [[0, l.pts[0]], [1, l.pts[l.pts.length - 1]]]) {
          const kk = key(pt); if (!nodes.has(kk)) nodes.set(kk, []); nodes.get(kk).push({ i, end });
        }
      });
      let total = 0; const pick = lines.map((l) => (total += l.w));
      net = { origin: center, k, lines, nodes, pick, total, key };

      // how built-up is it? fraction of a 300 m disc covered by building footprints
      const bfeats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
      let area = 0; const bseen = new Set();
      for (const f of bfeats) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
        for (const poly of polys) {
          const ring = poly[0]; if (!ring || ring.length < 3) continue;
          const sig = ring[0][0].toFixed(6) + ring[0][1].toFixed(6) + ring.length;
          if (bseen.has(sig)) continue; bseen.add(sig);
          const x0 = (ring[0][0] - center.lng) / k.lng, y0 = (ring[0][1] - center.lat) / k.lat;
          if (x0 * x0 + y0 * y0 > 300 * 300) continue;
          let a = 0;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            a += ((ring[j][0] - center.lng) / k.lng) * ((ring[i][1] - center.lat) / k.lat) - ((ring[i][0] - center.lng) / k.lng) * ((ring[j][1] - center.lat) / k.lat);
          }
          area += Math.abs(a) / 2;
        }
      }
      state.coverage = clamp(area / (Math.PI * 300 * 300), 0, 1);
      walkers = [];
      updateTarget(true);
    }

    function hourCurve(h) {
      // relative pedestrian activity by local hour (0..1)
      const pts = [[0, .25], [2, .08], [4, .03], [6, .12], [8, .75], [9, .6], [12, .8], [14, .65], [17, .85], [19, 1], [21, .7], [23, .4], [24, .25]];
      for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) { const [h0, v0] = pts[i - 1], [h1, v1] = pts[i]; return lerp(v0, v1, (h - h0) / (h1 - h0)); }
      return .25;
    }

    function updateTarget(initial) {
      if (!net) return;
      const lp = localParts(simNow());
      const hour = lp.h + lp.m / 60;
      const w = state.weather;
      let weatherF = 1;
      if (w) weatherF = (1 - w.rain * 0.65) * (1 - w.snow * 0.5) * (w.thunder ? 0.4 : 1) * (w.temp < -10 ? 0.6 : 1);
      const urban = Math.pow(smooth(0.01, 0.38, state.coverage), 1.3);
      const footNet = clamp(net.total / 60000, 0, 1); // walkable length (weighted) near you
      state.crowdTarget = net.lines.length ? Math.round(1100 * urban * Math.max(footNet, 0.2) * hourCurve(hour) * weatherF) : 0;
      const n = state.crowdTarget;
      const label = n === 0 ? 'nobody around' : n < 10 ? 'a few people' : n < 60 ? 'quiet street' : n < 250 ? 'busy' : n < 600 ? 'crowded' : 'packed';
      $('crowd').textContent = `${label} · ~${n} walking nearby`;
      $('crowd').title = `Modelled, not tracked: building coverage ${(state.coverage * 100).toFixed(0)}% × local hour × weather`;
      if (initial) while (walkers.length < n) walkers.push(spawn());
    }

    function spawn(atEdge) {
      const r = Math.random() * net.total;
      let lo = 0, hi = net.pick.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (net.pick[mid] < r) lo = mid + 1; else hi = mid; }
      const line = lo;
      const umbrella = state.weather && state.weather.rain > 0.2 && Math.random() < 0.8;
      return {
        line, s: Math.random() * net.lines[line].len, dir: Math.random() < 0.5 ? 1 : -1,
        side: (Math.random() < 0.5 ? -1 : 1) * (net.lines[line].side * (0.75 + Math.random() * 0.5)),
        v: (1.15 + Math.random() * 0.45) * (state.weather && state.weather.rain > 0.3 ? 1.12 : 1),
        pause: 0,
        c: umbrella ? UMBRELLAS[(Math.random() * UMBRELLAS.length) | 0] : CLOTHES[(Math.random() * CLOTHES.length) | 0],
        fadeIn: atEdge ? 0 : 1,
      };
    }

    function turn(p) {
      const l = net.lines[p.line];
      const endPt = p.dir > 0 ? l.pts[l.pts.length - 1] : l.pts[0];
      const opts = (net.nodes.get(net.key(endPt)) || []).filter((o) => o.i !== p.line);
      if (opts.length && Math.random() < 0.9) {
        const o = opts[(Math.random() * opts.length) | 0];
        p.line = o.i; p.dir = o.end === 0 ? 1 : -1; p.s = o.end === 0 ? 0 : net.lines[o.i].len;
        p.side = Math.sign(p.side) * net.lines[o.i].side * (0.75 + Math.random() * 0.5);
      } else {
        p.dir *= -1; p.side *= -1;
      }
      if (Math.random() < 0.15) p.pause = 2 + Math.random() * 10; // waiting at a crossing
    }

    function position(p) {
      const l = net.lines[p.line];
      let i = 1; while (i < l.cum.length - 1 && l.cum[i] < p.s) i++;
      const a = l.pts[i - 1], b = l.pts[i];
      const segLen = l.cum[i] - l.cum[i - 1] || 1;
      const t = (p.s - l.cum[i - 1]) / segLen;
      const nx = -(b[1] - a[1]) / segLen, ny = (b[0] - a[0]) / segLen;
      const x = lerp(a[0], b[0], t) + nx * p.side, y = lerp(a[1], b[1], t) + ny * p.side;
      return [net.origin.lng + x * net.k.lng, net.origin.lat + y * net.k.lat];
    }

    function step(dt, now) {
      if (!net) return;
      for (const p of walkers) {
        if (p.pause > 0) { p.pause -= dt; continue; }
        p.s += p.v * dt * p.dir;
        const len = net.lines[p.line].len;
        if (p.s > len || p.s < 0) { p.s = clamp(p.s, 0, len); turn(p); }
      }
      // ease population toward the target (people arriving / heading home)
      const target = state.crowdTarget;
      if (walkers.length < target && Math.random() < dt * Math.max(1, (target - walkers.length) * 0.2)) walkers.push(spawn(true));
      if (walkers.length > target && Math.random() < dt * Math.max(1, (walkers.length - target) * 0.2)) walkers.splice((Math.random() * walkers.length) | 0, 1);

      if (now - lastPush > 66) { // ~15 Hz is plenty at walking speed
        lastPush = now;
        const src = map.getSource('people');
        if (src) src.setData({
          type: 'FeatureCollection',
          features: walkers.map((p) => ({ type: 'Feature', properties: { c: p.c }, geometry: { type: 'Point', coordinates: position(p) } })),
        });
      }
    }

    return { reset, build, step, updateTarget, get net() { return net; } };
  })();

  let rebuildTimer = 0;
  function maybeRebuildNetwork() {
    if (!state.here || map.getZoom() < 15 || map.isMoving()) return;
    const c = map.getCenter();
    const center = { lng: c.lng, lat: c.lat };
    if (people.net && distM(people.net.origin, center) < 350 && people.net.lines.length) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { if (!map.isMoving()) people.build(center); }, 250);
  }
  setInterval(() => people.updateTarget(false), 5000);

  // ---------- precipitation & lightning ----------
  const precip = (() => {
    const cv = $('precip'); const ctx = cv.getContext('2d');
    let w = null; let drops = []; let W = 0, H = 0, dpr = 1; let nextFlash = 0;
    function resize() { dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    addEventListener('resize', resize); resize();
    function set(weather) {
      w = weather; drops = [];
      if (!w) return;
      const n = Math.round(w.rain * 900 + w.snow * 600);
      for (let i = 0; i < n; i++) drops.push(newDrop(true));
      nextFlash = performance.now() + 3000 + Math.random() * 8000;
    }
    function newDrop(anywhere) {
      const snow = w.snow > 0 && (w.rain === 0 || Math.random() < 0.5);
      return { x: Math.random() * W * 1.2 - W * 0.1, y: anywhere ? Math.random() * H : -20, z: 0.4 + Math.random() * 0.6, snow, ph: Math.random() * 6.28 };
    }
    function step(dt, now) {
      ctx.clearRect(0, 0, W, H);
      if (!w || !state.here) return;
      // wind blows toward (dir + 180); screen-space slant depends on map bearing
      const windTo = (w.windDir + 180 - map.getBearing()) * DEG;
      const slant = Math.sin(windTo) * clamp(w.wind / 40, 0, 1);
      ctx.lineCap = 'round';
      for (const d of drops) {
        if (d.snow) {
          d.y += (40 + 30 * d.z) * dt; d.x += (slant * 60 + Math.sin(now / 900 + d.ph) * 12) * dt;
          ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * d.z})`;
          ctx.beginPath(); ctx.arc(d.x, d.y, 1 + 2 * d.z, 0, 6.283); ctx.fill();
        } else {
          const vy = 900 + 700 * d.z, vx = slant * 380;
          d.y += vy * dt; d.x += vx * dt;
          ctx.strokeStyle = `rgba(200,215,235,${0.18 + 0.3 * d.z})`; ctx.lineWidth = 0.6 + d.z;
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - vx * 0.02, d.y - vy * 0.02 * (0.6 + d.z)); ctx.stroke();
        }
        if (d.y > H + 20 || d.x < -50 || d.x > W + 50) Object.assign(d, newDrop(false));
      }
      if (w.thunder && now > nextFlash) {
        const f = $('flash');
        f.animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0.1 }, { opacity: 0.4 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
        nextFlash = now + 5000 + Math.random() * 15000;
      }
    }
    return { set, step };
  })();

  // ---------- clock / UI ----------
  function renderClock() {
    if (!state.here) return;
    const lp = localParts(simNow());
    $('clock').textContent = `${pad(lp.h)}:${pad(lp.m)}:${pad(lp.s)}`;
    const dateStr = lp.d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const tz = state.utcOffsetSec != null ? (state.tzName || '') : 'approx. time zone';
    $('date').textContent = `${dateStr} · ${tz}${state.shiftHours ? ' · shifted' : ''}`;
  }

  const shift = $('shift');
  shift.addEventListener('input', () => {
    state.shiftHours = parseFloat(shift.value);
    $('shiftLabel').textContent = state.shiftHours === 0 ? 'live' : `${state.shiftHours > 0 ? '+' : ''}${state.shiftHours} h (weather stays live)`;
    renderClock(); applySunAndSky(true); people.updateTarget(false);
  });
  $('live').addEventListener('click', () => { shift.value = 0; shift.dispatchEvent(new Event('input')); });
  $('globe').addEventListener('click', backToGlobe);

  const chips = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name;
    b.addEventListener('click', () => goTo({ lng: p.lng, lat: p.lat }, p.name));
    chips.appendChild(b);
  }

  // ---------- main loop ----------
  let last = performance.now(), lastSec = 0, frames = 0, fpsT = last;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    people.step(dt, now);
    precip.step(dt, now);
    if (now - lastSec > 1000) { lastSec = now; renderClock(); applySunAndSky(false); }
    frames++;
    if (now - fpsT > 1000) { $('fps').textContent = `${Math.round(frames * 1000 / (now - fpsT))} fps`; frames = 0; fpsT = now; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // deep link: #lat,lng
  const m = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) map.once('load', () => goTo({ lat: +m[1], lng: +m[2] }));

  window.__oneMinute = { map, state, goTo }; // handy for debugging
})();
