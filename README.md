This project renders a deformable landscape in WebGL.

### Graphics Enhancement

Textures now use the maximum supported anisotropy value for crisper detail at glancing angles.

### UI Updates

- Sprint button arrow is now drawn with CSS for a consistent look.
- The on-screen arrow guiding to targets has been replaced by an in-world
  GPS-style path that dynamically updates.
- That path now forms a directional ribbon with a color gradient so you can
  immediately tell which way to head. The ribbon tapers from thick near you to
  thin at the target, removing the need for extra arrow markers.

### Procedural Terrain

The terrain is now generated on the client using Simplex noise so no tile
server or baking step is required. Simply start the web and WebSocket servers
with `npm start` and connect.

### Gameplay

- Press the shoot button again to recall your boomerang early if it's already flying.
- Hitting a floor target now restores a small amount of health instead of awarding score.
- Random terrain strikes happen more frequently so keep moving!
- Spikes erupt from the ground before dealing damage so alert players can dodge.
- Characters briefly flash red when hurt so you can tell a hit landed.
