# test

## seat-view

See the view from your seat before you book. One shared engine (`seat-view/shared/`) powers five venues:

- `cinema/`: distance to the screen and how much of your view it fills (2D and IMAX)
- `concert/`: floor or tier, distance to the stage, sound-desk line
- `stadium/`: four stands, height above the pitch, day or floodlit
- `restaurant/`: which chair faces the sea, at lunch, sunset or night
- `aircraft/`: window, middle or aisle, legroom, wing in the window

Static site, no build step. Deploy `seat-view/` as the root (see `seat-view/vercel.json`).
