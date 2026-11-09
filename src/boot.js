/* Picks the engine: Google Photorealistic 3D (street level) when a key is available,
 * otherwise the free OpenStreetMap map. ?engine=map forces the basic map.
 * Key sources, in order: ?gkey=… (remembered in this browser), /api/config (Vercel env). */
(async () => {
  const params = new URLSearchParams(location.search);
  const load = (src, isCss) => new Promise((res, rej) => {
    const el = document.createElement(isCss ? 'link' : 'script');
    if (isCss) { el.rel = 'stylesheet'; el.href = src; } else { el.src = src; }
    el.onload = res; el.onerror = () => rej(new Error('failed to load ' + src));
    document.head.appendChild(el);
  });
  let key = params.get('gkey');
  try {
    if (key) localStorage.setItem('oma.gkey', key); else key = localStorage.getItem('oma.gkey');
  } catch { /* storage blocked */ }
  if (!key && params.get('engine') !== 'map') {
    try {
      const r = await fetch('api/config', { cache: 'no-store' });
      if (r.ok) key = (await r.json()).googleKey;
    } catch { /* no config endpoint (local file server) */ }
  }
  const note = document.getElementById('engineNote');
  if (key && params.get('engine') !== 'map') {
    window.OMA_GOOGLE_KEY = key;
    window.CESIUM_BASE_URL = 'https://unpkg.com/cesium@1.130.0/Build/Cesium/';
    await load(window.CESIUM_BASE_URL + 'Widgets/widgets.css', true);
    await load(window.CESIUM_BASE_URL + 'Cesium.js');
    await load('src/street.js');
  } else {
    note.textContent = params.get('gerr')
      ? 'Google rejected the Maps key, so this is the basic map. Check that the Map Tiles API is enabled and the key allows this site.'
      : 'Basic map. Photorealistic street level turns on once a Google Maps key is set.';
    await load('https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.css', true);
    await load('https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.js');
    await load('src/app.js');
  }
})();
