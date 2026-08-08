#!/usr/bin/env python3
"""Draw the demo project's art from scratch.

Everything the editor ships with is generated here, so the repository carries
no third-party sprites. Output is deterministic: same seed, same pixels.

    python3 tools/make_demo_assets.py

Layers are tileable on their own width. Sprites are horizontal strips of
equal-width frames, which is the only sheet layout the editor cares about.
"""

import math
import os
import random

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = os.path.join(HERE, "demo", "assets", "layers")
SPRITES = os.path.join(HERE, "demo", "assets", "sprites")

# One palette for the whole demo keeps the parallax reading as a single place.
SKY_TOP = (86, 140, 196)
SKY_LOW = (163, 205, 224)
HILL_FAR = (108, 138, 158)
HILL_MID = (86, 122, 140)
TREE_DARK = (44, 92, 74)
TREE_LIT = (66, 122, 92)
TRUNK = (74, 58, 48)
GRASS = (108, 168, 96)
GRASS_DARK = (78, 132, 74)
DIRT = (128, 104, 74)
FUR = (226, 154, 92)
FUR_DARK = (176, 108, 62)
INK = (58, 44, 40)
BELLY = (248, 218, 176)
BIRD = (52, 58, 78)


def new(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def save(im, folder, name):
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    im.save(path)
    print(os.path.relpath(path, HERE))


def wrap_ellipse(d, cx, cy, rx, ry, width, fill):
    """An ellipse that wraps around the right edge, so the layer stays tileable."""
    for shift in (-width, 0, width):
        d.ellipse([cx - rx + shift, cy - ry, cx + rx + shift, cy + ry], fill=fill)


def sky(w=320, h=160):
    im = new(w, h)
    px = im.load()
    for y in range(h):
        t = min(1.0, y / (h * 0.72))
        col = tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_LOW))
        for x in range(w):
            px[x, y] = col + (255,)
    # a few flat clouds, wrapped so the strip repeats seamlessly
    rng = random.Random(7)
    d = ImageDraw.Draw(im)
    for _ in range(5):
        cx, cy = rng.randrange(w), rng.randrange(14, 60)
        for i in range(rng.randint(3, 5)):
            wrap_ellipse(d, cx + i * 11 - 16, cy + (i % 2) * 3,
                         rng.randint(9, 16), rng.randint(4, 6), w, (238, 246, 250, 255))
    return im


def hills(w=256, h=72, seed=3, colour=HILL_FAR, bumps=5):
    im = new(w, h)
    d = ImageDraw.Draw(im)
    rng = random.Random(seed)
    for i in range(bumps):
        cx = round(w * (i + rng.random() * 0.6) / bumps)
        wrap_ellipse(d, cx, h - 6, rng.randint(34, 62), rng.randint(24, 40), w, colour + (255,))
    d.rectangle([0, h - 8, w, h], fill=colour + (255,))
    return im


def trees(w=256, h=64):
    im = new(w, h)
    d = ImageDraw.Draw(im)
    rng = random.Random(11)
    x = 4
    while x < w + 24:
        th = rng.randint(26, 44)
        top = h - th
        d.rectangle([x + 5, h - 12, x + 8, h], fill=TRUNK + (255,))
        for r, col in ((9, TREE_DARK), (7, TREE_LIT)):
            wrap_ellipse(d, x + 6, top + 10, r, r + 2, w, col + (255,))
            wrap_ellipse(d, x + 6, top + 20, r + 1, r, w, col + (255,))
        x += rng.randint(17, 27)
    return im


def ground(w=256, h=48):
    im = new(w, h)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h], fill=GRASS + (255,))
    d.rectangle([0, 0, w, 2], fill=GRASS_DARK + (255,))
    rng = random.Random(23)
    for _ in range(260):
        x, y = rng.randrange(w), rng.randrange(4, h)
        col = GRASS_DARK if rng.random() < 0.7 else DIRT
        d.point((x, y), fill=col + (255,))
    for _ in range(18):  # tufts, wrapped
        x, y = rng.randrange(w), rng.randrange(6, h - 4)
        for k in range(3):
            d.line([(x + k * 2) % w, y, (x + k * 2) % w, y - 2 - (k % 2)],
                   fill=GRASS_DARK + (255,))
    return im


def foreground(w=256, h=26):
    """Blades that ride in front of everything, fastest layer of the set."""
    im = new(w, h)
    d = ImageDraw.Draw(im)
    rng = random.Random(31)
    x = 0
    while x < w:
        bh = rng.randint(9, h - 4)
        lean = rng.choice((-1, 0, 1))
        for i in range(bh):
            d.point(((x + lean * i // 4) % w, h - 1 - i),
                    fill=(GRASS_DARK if i > bh // 2 else GRASS) + (255,))
        x += rng.randint(1, 4)
    return im


def walker(frames=4, fw=24, fh=24):
    """A four-legged critter: body bobs, legs swing, ears trail."""
    im = new(fw * frames, fh)
    d = ImageDraw.Draw(im)
    for f in range(frames):
        ox = f * fw
        bob = (0, -1, 0, 1)[f]
        swing = (3, 0, -3, 0)[f]
        body_y = 9 + bob
        d.ellipse([ox + 4, body_y, ox + 18, body_y + 9], fill=FUR + (255,))
        d.ellipse([ox + 4, body_y + 4, ox + 17, body_y + 9], fill=FUR_DARK + (255,))
        d.ellipse([ox + 13, body_y - 5, ox + 21, body_y + 3], fill=FUR + (255,))  # head
        d.polygon([(ox + 14, body_y - 4), (ox + 12, body_y - 9), (ox + 17, body_y - 5)],
                  fill=FUR_DARK + (255,))                                          # ear
        d.point((ox + 18, body_y - 2), fill=INK + (255,))                          # eye
        d.line([ox + 20, body_y, ox + 21, body_y + 1], fill=INK + (255,))          # snout
        d.ellipse([ox + 8, body_y + 5, ox + 15, body_y + 9], fill=BELLY + (255,))
        for lx, phase in ((6, 1), (15, -1)):                                       # legs
            dx = swing * phase
            d.line([ox + lx, body_y + 8, ox + lx + dx // 2, fh - 2], fill=FUR_DARK + (255,))
            d.line([ox + lx + 2, body_y + 8, ox + lx + 2 - dx // 2, fh - 2],
                   fill=FUR + (255,))
        d.line([ox + 4, body_y + 2, ox + 1, body_y - 2 - bob], fill=FUR_DARK + (255,))
    return im


def bird(frames=2, fw=16, fh=12):
    im = new(fw * frames, fh)
    d = ImageDraw.Draw(im)
    for f in range(frames):
        ox = f * fw
        up = f == 0
        d.ellipse([ox + 6, 5, ox + 11, 8], fill=BIRD + (255,))
        wing_y = 2 if up else 8
        d.line([ox + 2, wing_y, ox + 7, 6], fill=BIRD + (255,), width=1)
        d.line([ox + 10, 6, ox + 14, wing_y], fill=BIRD + (255,), width=1)
        d.point((ox + 12, 6), fill=BIRD + (255,))
    return im


def cloud_piece(fw=40, fh=16):
    im = new(fw, fh)
    d = ImageDraw.Draw(im)
    for cx, cy, r in ((12, 10, 7), (22, 8, 9), (31, 11, 6)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(248, 252, 255, 235))
    return im


def main():
    save(sky(), LAYERS, "sky.png")
    save(hills(seed=3, colour=HILL_FAR, bumps=4), LAYERS, "hills_far.png")
    save(hills(seed=5, colour=HILL_MID, bumps=6), LAYERS, "hills_near.png")
    save(trees(), LAYERS, "trees.png")
    save(ground(), LAYERS, "ground.png")
    save(foreground(), LAYERS, "grass_front.png")
    save(walker(), SPRITES, "walker.png")
    save(bird(), SPRITES, "bird.png")
    save(cloud_piece(), SPRITES, "cloud.png")


if __name__ == "__main__":
    main()
