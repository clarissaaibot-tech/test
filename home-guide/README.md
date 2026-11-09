# Home Fix Map

A 3D map of an apartment where every appliance is clickable. Tap the TV and you get the HDMI / ARC checks. Tap the oven and you get the timer and temperature checks. Each appliance has:

- **Start here**: ordered checks you tick off as you try them
- **If you see…**: common symptoms and what they mean
- **Call a pro if**: when to stop and get help
- **Model number**: saved in your browser, and used to search for the right manual

## Flow

room photos → 3D layout → appliances placed where they really are → help for each one

## Using your own home

Everything lives in two lists at the top of `index.html`:

- `HOME`: room rectangles, wall segments (with door gaps) and furniture, in metres
- `APPLIANCES`: position, size, colour and help content for each appliance

Swap those for your real layout and appliances, and the map, pins, list and help panels all update.

Open `index.html` in a browser to run it. It loads Three.js from a CDN, so there is no build step.
