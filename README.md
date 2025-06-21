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
