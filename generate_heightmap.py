#!/usr/bin/env python3
import numpy as np
import pandas as pd
from scipy.interpolate import griddata
from PIL import Image

# ─── Load the CSV ────────────────────────────────────────────
df = pd.read_csv("oeis_landscape_classified.csv")
theta = df["theta"].values
R     = df["R"].values
cls   = df["classification"].values  # string labels

# Mask invalids
mask = (~np.isnan(theta)) & (~np.isnan(R))
theta, R, cls = theta[mask], R[mask], cls[mask]

# ─── Grid parameters ────────────────────────────────────────
n = 200  # match your RESOLUTION+1 in main.js
t_lin = np.linspace(theta.min(), theta.max(), n)
R_lin = np.linspace(R.min(),         R.max(),         n)
Tg, Rg  = np.meshgrid(t_lin, R_lin)

# ─── Interpolate each class via nearest-neighbor ────────────
# We'll assign each (theta,R) point its class, then for each grid cell
# find the nearest sample and color by that sample's class.
from scipy.spatial import cKDTree
pts = np.vstack([theta, R]).T
tree = cKDTree(pts)
grid_pts = np.vstack([Tg.ravel(), Rg.ravel()]).T
_, idx = tree.query(grid_pts)

# Map labels → RGB
color_map = {
    "Predictable":       (0, 255,   0),
    "Partially Predictable": (255,255, 0),
    "Unpredictable":     (255,   0,   0),
}
# If your CSV uses a different name for “partially predictable,” adjust above.

# Build RGB array
rgb = np.zeros((n*n, 3), dtype=np.uint8)
for i, c in enumerate(cls[idx]):
    rgb[i] = color_map.get(c, (128,128,128))  # fallback grey

rgb = rgb.reshape((n, n, 3))

# ─── Save PNG ────────────────────────────────────────────────
img = Image.fromarray(rgb, mode="RGB")
img.save("assets/classmap.png")
print("Saved assets/classmap.png")
