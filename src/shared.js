/* Shared pieces for the street-level (Cesium + Google 3D) mode:
 * weather, local time, crowd model, sky tint / fog overlays, rain & snow. */
(() => {
  'use strict';
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a) => a == null ? `rgb(${c.map(Math.round).join(',')})` : `rgba(${c.map(Math.round).join(',')},${a})`;
  const $ = (id) => document.getElementById(id);

  const PRESETS = [
    { name: 'Shibuya, Tokyo', lng: 139.7005, lat: 35.6595 },
    { name: 'Gion, Kyoto', lng: 135.7752, lat: 35.0037 },
    { name: 'Okinawa coast', lng: 127.9786, lat: 26.6943 },
    { name: 'Times Square', lng: -73.9855, lat: 40.758 },
    { name: 'Paris', lng: 2.3488, lat: 48.8534 },
    { name: 'Reykjavík', lng: -21.9333, lat: 64.1466 },
  ];

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

  async function fetchWeather(p) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(4) + '&longitude=' + p.lng.toFixed(4) +
      '&current=temperature_2m,apparent_temperature,weather_code,cloud_cover,visibility,precipitation,wind_speed_10m,wind_direction_10m' +
      '&timezone=auto';
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const c = j.current, code = c.weather_code, vis = c.visibility ?? 20000;
        let fog = clamp(1 - Math.log10(Math.max(vis, 100) / 150) / Math.log10(20000 / 150), 0, 1);
        if (code === 45 || code === 48) fog = Math.max(fog, 0.65);
        return {
          utcOffsetSec: j.utc_offset_seconds, tzName: j.timezone_abbreviation || j.timezone, elevation: j.elevation,
          weather: {
            code, label: WMO[code] || `Code ${code}`, temp: c.temperature_2m, cloud: (c.cloud_cover ?? 0) / 100, vis, fog,
            rain: Math.max(RAIN_LEVEL[code] || 0, SNOW_LEVEL[code] ? 0 : clamp((c.precipitation || 0) / 4, 0, 1)),
            snow: SNOW_LEVEL[code] || 0, thunder: code >= 95,
            wind: c.wind_speed_10m || 0, windDir: c.wind_direction_10m || 0, fetched: Date.now(),
          },
        };
      } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 1200 * (attempt + 1))); }
    }
    throw lastErr;
  }

  function weatherText(w) {
    const visTxt = w.vis < 1000 ? `${Math.round(w.vis)} m` : `${(w.vis / 1000).toFixed(w.vis < 10000 ? 1 : 0)} km`;
    return `${w.label}, ${Math.round(w.temp)}°C · visibility ${visTxt} · wind ${Math.round(w.wind)} km/h`;
  }

  async function placeName(p) {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${p.lat}&longitude=${p.lng}&localityLanguage=en`);
    const j = await r.json();
    const parts = [j.locality, j.city !== j.locality ? j.city : null, j.countryName].filter(Boolean);
    return parts.length ? parts.join(', ') : `Open water · ${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`;
  }

  // ---------- time & sun ----------
  function localParts(date, utcOffsetSec, lng) {
    const off = utcOffsetSec != null ? utcOffsetSec : Math.round((lng || 0) / 15) * 3600;
    const d = new Date(date.getTime() + off * 1000);
    return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(), d };
  }

  function sun(date, p) {
    const pos = SunCalc.getPosition(date, p.lat, p.lng);
    return { alt: pos.altitude / DEG, bearing: (pos.azimuth / DEG + 180 + 360) % 360 };
  }

  function sunText(s) {
    const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(s.bearing / 45) % 8];
    const phase = s.alt > 6 ? 'up' : s.alt > 0 ? 'low, golden hour' : s.alt > -6 ? 'just set / twilight' : s.alt > -18 ? 'below horizon, dusk light' : 'night';
    return `${s.alt.toFixed(1)}° ${compass} · ${phase}`;
  }

  // ---------- crowd model (not tracking) ----------
  function hourCurve(h) {
    const pts = [[0, .25], [2, .08], [4, .03], [6, .12], [8, .75], [9, .6], [12, .8], [14, .65], [17, .85], [19, 1], [21, .7], [23, .4], [24, .25]];
    for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) { const [h0, v0] = pts[i - 1], [h1, v1] = pts[i]; return lerp(v0, v1, (h - h0) / (h1 - h0)); }
    return .25;
  }
  function crowd({ coverage, walkWeight, hour, weather, max }) {
    let wf = 1;
    if (weather) wf = (1 - weather.rain * 0.65) * (1 - weather.snow * 0.5) * (weather.thunder ? 0.4 : 1) * (weather.temp < -10 ? 0.6 : 1);
    const urban = Math.pow(smooth(0.01, 0.38, coverage), 1.3);
    const foot = clamp(walkWeight / 60000, 0, 1);
    const n = walkWeight > 0 ? Math.round(max * urban * Math.max(foot, 0.2) * hourCurve(hour) * wf) : 0;
    const label = n === 0 ? 'nobody around' : n < 10 ? 'a few people' : n < 60 ? 'quiet street' : n < 200 ? 'busy' : n < 450 ? 'crowded' : 'packed';
    return { n, label };
  }

  // ---------- screen tint + fog overlays ----------
  const NIGHT = [74, 88, 150], TWILIGHT = [150, 138, 190], GOLDEN = [255, 196, 150], DAY = [255, 255, 255];
  function tintFor(alt) {
    if (alt < -8) return NIGHT;
    if (alt < -2) return mix3(NIGHT, TWILIGHT, smooth(-8, -2, alt));
    if (alt < 4) return mix3(TWILIGHT, GOLDEN, smooth(-2, 4, alt));
    if (alt < 14) return mix3(GOLDEN, DAY, smooth(4, 14, alt));
    return DAY;
  }
  function applyOverlays({ sunAlt, weather, active, canvas }) {
    const cloud = weather ? weather.cloud : 0;
    const day = smooth(-6, 6, sunAlt);
    let tint = active ? tintFor(sunAlt) : DAY;
    tint = mix3(tint, [205, 208, 215], cloud * 0.5 * day * (active ? 1 : 0));
    if (active && weather && (weather.rain > 0.5 || weather.thunder)) tint = mix3(tint, [170, 175, 190], 0.4 * day);
    $('tint').style.backgroundColor = rgb(tint);
    if (canvas) canvas.style.filter = active ? `saturate(${(1 - cloud * 0.35 * day - (1 - day) * 0.3).toFixed(2)})` : '';
    const fogAmt = active && weather ? weather.fog : 0;
    const fogCol = mix3([40, 46, 62], [222, 226, 232], day);
    const fogEl = $('fog');
    fogEl.style.background = `linear-gradient(to bottom, ${rgb(fogCol, Math.min(0.97, fogAmt * 1.05))} 0%, ${rgb(fogCol, fogAmt * 0.9)} 35%, ${rgb(fogCol, fogAmt * 0.45)} 100%)`;
    fogEl.style.opacity = fogAmt > 0.02 ? 1 : 0;
    return { day, cloud, fogAmt };
  }

  // ---------- rain / snow / lightning ----------
  function makePrecip(getBearingDeg) {
    const cv = $('precip'); const ctx = cv.getContext('2d');
    let w = null, drops = [], W = 0, H = 0, nextFlash = 0;
    function resize() { const dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    addEventListener('resize', resize); resize();
    const newDrop = (anywhere) => ({ x: Math.random() * W * 1.2 - W * 0.1, y: anywhere ? Math.random() * H : -20, z: 0.4 + Math.random() * 0.6, snow: w.snow > 0 && (w.rain === 0 || Math.random() < 0.5), ph: Math.random() * 6.28 });
    function set(weather) {
      w = weather; drops = [];
      if (!w) return;
      const n = Math.round(w.rain * 900 + w.snow * 600);
      for (let i = 0; i < n; i++) drops.push(newDrop(true));
      nextFlash = performance.now() + 3000 + Math.random() * 8000;
    }
    function step(dt, now, active) {
      ctx.clearRect(0, 0, W, H);
      if (!w || !active) return;
      const windTo = (w.windDir + 180 - getBearingDeg()) * DEG;
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
        $('flash').animate([{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0.1 }, { opacity: 0.4 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
        nextFlash = now + 5000 + Math.random() * 15000;
      }
    }
    return { set, step };
  }

  window.OMA = { DEG, clamp, lerp, smooth, PRESETS, fetchWeather, weatherText, placeName, localParts, sun, sunText, crowd, applyOverlays, makePrecip };
})();
