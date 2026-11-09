# One Minute Anywhere

Tap any point on Earth and stand there for a minute.

Open `index.html` through any static server (for example `python3 -m http.server`) and go to `http://localhost:8000`.
You can also link straight to a spot: `index.html#35.6595,139.7005`.

## Street level (Google Photorealistic 3D)

With a Google Maps key the page switches to CesiumJS + Google's Photorealistic 3D Tiles:
tap a place, it flies in, drops you to eye height (1.65 m) and you walk.

- Drag to look; W A S D or arrows to walk; Shift to run; on phones use the on-screen pad.
- Walls block you, and you follow the ground up steps and slopes (rays cast into the 3D tiles).
- "Aerial view" / "Street view" switches between flying above and walking.

Setting the key:
1. In Google Cloud, enable the **Map Tiles API** and create an API key.
2. Restrict the key to HTTP referrers, e.g. `one-minute-anywhere.vercel.app/*` (the key is visible to
   browsers by design; the restriction is what protects it).
3. In Vercel → project → Settings → Environment Variables, add `GOOGLE_MAPS_API_KEY`, then redeploy.

For a quick local test you can also open `index.html?gkey=YOUR_KEY` (remembered in that browser).
`?engine=map` forces the free basic map. Without a key the free basic map is used.

## What's real and what's modelled

| Thing | Source |
|---|---|
| Map, 3D buildings, streets | OpenStreetMap via OpenFreeMap vector tiles (no key) |
| Local time and time zone | Open-Meteo's `utc_offset_seconds` for that coordinate |
| Sun position, light direction, shadows | SunCalc; shadows are projected from each building's OSM height, length = height / tan(sun altitude) |
| Weather (fog, drizzle, rain, snow, thunder, wind) | Open-Meteo current conditions, refreshed every 10 min |
| Place name | BigDataCloud reverse geocoding (client endpoint, no key) |
| **People** | **A model, not tracking.** Crowd size = building coverage within 300 m × local-hour activity curve × weather penalty. Walkers move at real walking speed along the real OSM street and footpath network. |

The time slider moves the clock and the sun ±12 h; the weather stays live.

## Files

- `index.html`: page and overlays
- `src/boot.js`: picks the engine (Google 3D when a key exists, else basic map)
- `src/street.js`: Google 3D street level: fly-in, walking, people as billboards
- `src/shared.js`: weather, time, sun text, crowd model, tint/fog, rain/snow (used by street level)
- `src/app.js`: basic MapLibre map (free fallback)
- `src/style.css`: UI
- `api/config.js`: Vercel function that hands the page `GOOGLE_MAPS_API_KEY`
