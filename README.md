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

### Baked Terrain Tiles

Run `./bake_tiles.py --min -1 -1 --max 1 1 --out tiles` to generate OBJ
files for tiles within the given coordinate range. Start the HTTP server
with `./tile_server.js` and your client can fetch `chunk_x_z.obj` files on
demand.

Alternatively, run `start-sig.ps1` to automatically bake the tiles and start all servers.
