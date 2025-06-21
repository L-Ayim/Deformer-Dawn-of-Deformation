#!/usr/bin/env python3
"""Pre-bake terrain tiles as OBJ meshes."""
import os, argparse, math, random
import numpy as np

CHUNK_SIZE = 512      # meters
GRID = 64             # quads per side
VERTS = GRID + 1
AMPLITUDE = 50

# ───── simple perlin noise implementation ─────
def fade(t):
    return t*t*t*(t*(t*6-15)+10)

def lerp(a,b,t):
    return a + t*(b-a)

def grad(hash, x, y):
    h = hash & 3
    u = x if h<2 else y
    v = y if h<2 else x
    return (u if (h&1)==0 else -u) + (v if (h&2)==0 else -v)

class Perlin:
    def __init__(self, seed=0):
        rng = random.Random(seed)
        p = list(range(256))
        rng.shuffle(p)
        self.p = p + p
    def noise(self,x,y):
        xi = int(math.floor(x)) & 255
        yi = int(math.floor(y)) & 255
        xf = x - math.floor(x)
        yf = y - math.floor(y)
        u = fade(xf)
        v = fade(yf)
        aa = self.p[self.p[xi]+yi]
        ab = self.p[self.p[xi]+yi+1]
        ba = self.p[self.p[xi+1]+yi]
        bb = self.p[self.p[xi+1]+yi+1]
        x1 = lerp(grad(aa, xf, yf),   grad(ba, xf-1, yf),   u)
        x2 = lerp(grad(ab, xf, yf-1), grad(bb, xf-1, yf-1), u)
        return lerp(x1,x2,v)

noise = Perlin(0)

def generate_chunk(cx, cz, out_dir):
    """Generate OBJ for chunk at (cx,cz)."""
    size = CHUNK_SIZE
    verts = []
    for z in range(VERTS):
        for x in range(VERTS):
            world_x = cx*size + x*(size/GRID)
            world_z = cz*size + z*(size/GRID)
            h = noise.noise(world_x*0.01, world_z*0.01) * AMPLITUDE
            verts.append((world_x, h, world_z))

    faces = []
    for z in range(GRID):
        for x in range(GRID):
            i = z*VERTS + x
            a = i + 1
            b = i + 2
            c = i + VERTS + 1
            d = i + VERTS + 2
            faces.append((a,c,b))
            faces.append((b,c,d))

    path = os.path.join(out_dir, f"chunk_{cx}_{cz}.obj")
    with open(path, 'w') as f:
        for v in verts:
            f.write(f"v {v[0]:.3f} {v[1]:.3f} {v[2]:.3f}\n")
        for fa in faces:
            f.write(f"f {fa[0]} {fa[1]} {fa[2]}\n")
    print("Wrote", path)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument('--min', type=int, nargs=2, default=(0,0), help='min chunk x z')
    ap.add_argument('--max', type=int, nargs=2, default=(0,0), help='max chunk x z')
    ap.add_argument('--out', default='tiles', help='output directory')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for cz in range(args.min[1], args.max[1]+1):
        for cx in range(args.min[0], args.max[0]+1):
            generate_chunk(cx, cz, args.out)
