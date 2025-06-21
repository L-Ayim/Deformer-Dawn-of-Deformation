This project renders a deformable landscape in WebGL.

## Getting Started

1. Install dependencies with `npm install`.
2. Launch both the static site and WebSocket server using `npm start`.


### Graphics Enhancement

Textures now use the maximum supported anisotropy value for crisper detail at glancing angles.

### UI Updates

- Sprint button arrow is now drawn with CSS for a consistent look.
- Each remote player now has a gradient path from your position to theirs so you
  can easily find them.

### Procedural Terrain

The terrain is now generated on the client using Simplex noise so no tile
server or baking step is required. Simply start the web and WebSocket servers
with `npm start` and connect.

### Performance Options

The renderer caps pixel ratio at `0.75` and enables antialiasing by
default. Adjust `PIXEL_RATIO_CAP` and `USE_ANTIALIAS` in `js/main.js` if you
want to trade visual quality for higher frame rates.

### Gameplay

- Press the shoot button again to recall your boomerang early if it's already flying.
- Hitting a floor target now restores a small amount of health instead of awarding score. Targets appear as colored discs on the ground.
- Terrain spikes are disabled by default. To re-enable them,
  set `TERRAIN_ATTACKS_ENABLED` to `true` in `server.js`.
- Spikes would normally erupt from the ground before dealing damage so alert players can dodge.
- Characters briefly flash red when hurt so you can tell a hit landed.
- Boomerang shots now register hits when striking any limb, not just the torso.
