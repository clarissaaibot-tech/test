# One Minute Anywhere

Tap any point on Earth and stand there for a minute.

Open `index.html` through any static server (for example `python3 -m http.server`) and go to `http://localhost:8000`.
You can also link straight to a spot: `index.html#35.6595,139.7005`.

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

- `index.html`: page and layers
- `src/app.js`: map, sun/sky, shadows, weather, pedestrians, precipitation
- `src/style.css`: UI
