# Parallax Scene Editor

An editor for looping *pixel art* parallax scenes. It opens in the browser,
reads a folder **on your own disk** full of your sprites, and exports GIF, WebM
or a PNG sequence. No server, no build step, and nothing is uploaded anywhere.

**→ [Open the editor](https://christt105.github.io/parallax-scene-editor/)**

![demo](docs/preview.png)

## What it solves

A parallax background is easy to draw and a nuisance to assemble: every layer
moves at its own speed, sprites have their own cel cycle, and for the loop not
to jump, all of it has to fit into the same number of frames. Sprite editors do
not interpolate positions and video editors do not think in whole pixels.

Here a scene is **one JSON file**: camera, layers, actors, keyframes. You edit
it while watching it play on a loop, and the editor tells you in red when
something is not going to close.

## Getting started

Opening the page loads an example scene. To work on your own:

1. **Open folder…** and pick your project folder. The editor reads every image
   inside it, at any depth.
2. If the folder holds `.json` files, it offers to open them as a scene.
3. From there **the file follows the editor**: every change is written to disk
   on its own, a few hundred milliseconds after you stop touching it.

Opening folders with write access needs the File System Access API, which is
Chromium desktop only. **Chrome, Edge and Opera** have shipped it since v86;
**Brave** ships the same engine but keeps it behind a flag, off by default —
turn it on at `brave://flags` (search "File System") and reload the page.
**Firefox and Safari never expose it, in any version, on desktop or mobile** —
they only have OPFS, a private sandbox that cannot see your real folders.
Outside Chromium desktop, or on Brave until the flag is flipped, the button
still works but hands back a read-only snapshot of the folder rather than a
live link to it; *Save* downloads the JSON instead.

### Working against the disk

The pill next to *Save* says at all times where your work is going:

| | |
|---|---|
| `↳ scenes/level.json` | every change ends up there |
| `saving …` | a write is on its way |
| `no file yet · press Save` | there is a folder, but the scene has no file in it |
| `browser only` | no folder with write permission |

The editor **invents no files**: it only writes over one you opened from the
folder or created with *Save*. Picking a folder to look at it is not permission
to fill it with JSON, so the first time you have to name the file; after that
you never press anything again.

And in the other direction: **images that change on disk reload themselves**.
Repaint a sprite in Aseprite, save, and a few seconds later it is on the canvas
without you touching anything. The editor watches only the images it has
loaded, and in batches, so a folder with two thousand sprites costs the same as
one with twenty. For *new* files in the folder there is still *reload*.

The **auto** checkbox turns it off if you would rather save yourself, with
<kbd>Ctrl</kbd>+<kbd>S</kbd>. If a write fails — permission expired, folder
unmounted — autosave stops and says so, rather than retrying in a loop against
a disk that is no longer there; tick the box again and it carries on.

On top of all that, the scene is **also** autosaved in the browser (IndexedDB)
on every change. Close the tab by accident and it comes back where you left it;
you only have to grant permission on the folder again, which is the one thing
the browser will not let anyone automate.

You can also **drag** a folder or a few loose files onto the page. That works
in every browser, but as a read-only snapshot. Dropping files **adds** to what
is already loaded rather than replacing it.

### Where it looks for the images

There are two levels and it pays to keep them straight:

```
the folder you open/        ← the root of everything
  sprites/x1/               ← "asset root" (sprite_root), in the scene properties
    pokemon/torchic.png     ← "sprite", what each layer and actor carries
```

The final path is `sprite_root + sprite`, always relative to the folder you
opened. That way a whole scene can be moved by changing a single field.

When the two do not line up — because you opened the folder one level too high,
or the JSON came from somewhere else — the editor does **not** make you repick
twenty images: it says how many it cannot find, and *Repair paths* looks for
them by name among what is loaded. If they are all missing the same folder,
which is the usual case, it adjusts `sprite_root` and that is that; if they are
scattered, it fixes each one. It only tries when a scene or a folder is opened.

And when you want to take the scene elsewhere, *Export → Package* gives you a
zip with the JSON and **only the images it uses**, under `assets/`.

## The scene

```jsonc
{
  "canvas": [640, 360],      // output size in pixels
  "zoom": 2,                 // integer nearest-neighbour magnification
  "world_height": 160,       // world height; the rest is air above it
  "align": "bottom",         // where the world anchors inside the view
  "loop_frames": 256,
  "fps": 24,
  "backdrop": "#568cc4",
  "sprite_root": "assets",   // prefix for every path
  "layers": [ … ],
  "actors": [ … ]
}
```

The view is `canvas / zoom` pixels. The world anchors to the bottom by default,
so **pulling the camera back adds sky at the top** and everything standing on
the ground stays where it was.

### Layers

```jsonc
{
  "name": "ground",
  "sprite": "layers/ground.png",
  "y": 122,
  "depth": -110,
  "speed": 4,                // px per frame; positive scrolls leftwards
  "speed_y": 0,
  "tile_period": 256,        // 0 = the image's own width
  "repeat": "x",             // "x" | "none"
  "extend_up": false,        // repeat the top row upwards
  "extend_down": true,       // …and the bottom row downwards
  "opacity": 1
}
```

`extend_up` and `extend_down` exist because almost no layer is drawn for the
gap that opens up when the camera pulls back: repeating the edge row is cheaper
than drawing sky or soil nobody is going to look at.

A layer with a high `depth` is drawn **in front of** the actors: that is how
foreground grass is done.

For the loop to close seamlessly, `speed × loop_frames` has to be a multiple of
`tile_period`. The layer panel says so, and the status bar warns you **without
having to select it**, with the exact size of the jump: a layer that stops half
a tile short is invisible in a still frame and glaring the moment you press
play.

This narrows the possible speeds quite a lot. If the tile is 256 px and the
loop is 256 frames, the speed has to be a whole number, and the slowest layer
covers a full tile per loop. For the background to move *slowly*, either the
loop lasts more seconds or that layer is drawn narrower.

### You do not have to do the arithmetic

Knowing that something does not close is no use if you do not know what to put
instead, and the rule has an exact answer, so the editor works it out for you.
When a layer does not close, its panel says what the speed steps up in —
`period ÷ frames`, that is, one tile per loop — and gives you **the two that do
work**, the one below and the one above, with a button each:

```
travels 384 px per loop over a 256 px period · does not close: it will jump 128 px
over 256 frames the layer has to travel a whole number of 256 px tiles,
so the speed goes up in steps of 1:
     [ speed 1 · 1 tile ]  [ speed 2 · 2 tiles ]
or, leaving every speed exactly as it is, lengthen the loop:
     [ loop of 512 frames · 21.33 s ]
```

They are two different decisions, which is why both are there: changing the
speed moves that one layer and leaves the rest alone; lengthening the loop
**does not change a single px per frame** — nothing moves faster — but it lasts
longer. From the scene properties, that second button fixes everything that
does not close at once.

Same for actors: it offers the delays whose cycle divides the loop. And when
the cel count will not divide it *whatever you do* — three cels in a loop of
256, no delay saves it — it proposes the there-and-back order `0,1,2,1`, which
turns three cels into four, along with the delay that new count needs.

A longer loop is only proposed while it is still a loop: the number that suits
everything is a least common multiple, and one awkward value sends it to five
figures. Past four times the current length, the editor says how many frames it
would take and withholds the button.

### Actors

```jsonc
{
  "name": "runner",
  "sprite": "sprites/walker.png",
  "frames": 4,               // cels in the horizontal strip
  "grid": null,              // [columns, rows] if the sheet is a grid
  "order": [0, 1, 2, 1],     // reorders the cels
  "delay": 4,                // frames per cel
  "offset": 0,               // shifts the cycle within the loop
  "anchor": "bottom-center", // the usual nine anchors
  "depth": 20,
  "scale": 1,
  "flip_x": false,
  "x": 96, "y": 150,         // or "keys", never both
  "keys": [
    { "f": 0,   "x": 352, "y": 46, "ease": "linear" },
    { "f": 144, "x": -32, "y": 30, "ease": "linear" }
  ],
  "motion": [
    { "type": "sine", "axis": "y", "amp": 3, "period": 32 }
  ]
}
```

- **`keys`** are keyframed positions. They are interpolated with `ease`
  `linear`, `in`, `out` or `in-out`, and **the last stretch wraps back round to
  the first key** on its own, so the loop has no seam.
- **`motion`** is added on top of the position: `sine`, `cosine` or `wobble` (an
  N-pixel jitter, the periodic stand-in for the random noise a game would use).
  You can stack several.
- **`order`** fixes cycles that do not divide the loop: a there-and-back
  `[0,1,2,1]` turns a cycle of 3 into one of 4.

If an actor's cycle (`frames × delay`) does not divide `loop_frames`, the
sprite jumps at the wrap. The editor says so, with the exact number.

## How it is used

- **Dragging on the canvas** places the actor. If it has keyframes, you move the
  selected key (or the one nearest the frame you are on). <kbd>Shift</kbd> snaps
  to 8 px.
- **The timeline** has one row per actor with its keys as diamonds. Double click
  creates a key there; dragging a diamond moves it to another frame. The grey
  ticks mark where the cel cycle restarts.
- **The key path** is drawn over the canvas, so you can see the whole trajectory
  without pressing play.
- **Onion skin** overlays the actors from the neighbouring frames.
- **Hovering** an image in the assets panel shows it larger, with its
  dimensions: small sprites are magnified by a whole number so the pixels stay
  square.

| Shortcut | |
|---|---|
| <kbd>Space</kbd> | play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | previous / next frame (<kbd>Shift</kbd>: ten at a time) |
| <kbd>Alt</kbd> + arrows | move the actor 1 px (<kbd>Shift</kbd>: 8 px) |
| <kbd>K</kbd> | key at the current frame |
| <kbd>Del</kbd> | delete the key |
| <kbd>D</kbd> | duplicate |
| <kbd>G</kbd> / <kbd>O</kbd> | grid / onion skin |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | undo (with <kbd>Shift</kbd>, redo) |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | save |

## Exporting

- **GIF** — built here, without libraries. It first walks the animation counting
  colours: if the whole scene fits in 256 (the norm in pixel art) the palette is
  **exact**, with no *dithering* and no colour drift. If it does not fit, it
  falls back to *median cut*. Each frame is compressed the moment it is drawn,
  so exporting a long loop costs megabytes rather than hundreds of them.
- **WebM** — video with no colour limit, via `MediaRecorder`. Recorded in real
  time: it takes as long as the loop lasts.
- **PNG (zip)** — one file per frame, to assemble with ffmpeg or open in
  Aseprite.
- **Current frame** — a single PNG.
- **Package** — a zip with `scene.json` and the images the scene uses, under
  `assets/`, to take it to another machine or hand it to somebody.

*Keep 1 frame in every N* lowers the frame count and raises each frame's
duration, without touching the scene.

## Structure

No dependencies and no *bundler* in what gets served: they are ES modules the
browser loads as they are, which is also what lets GitHub Pages publish it
without compiling anything. The only thing in `package.json` is Playwright, for
the tests.

```
index.html · app.css
src/
  scene.js       the document: defaults, normalisation, warnings, suggestions
  anim.js        sampling: easing, keys, motion, anchors
  render.js      drawing into a canvas, at world resolution
  store.js       scene + undo history
  assets.js      local folder, drag-and-drop, remote manifest
  relink.js      squaring the scene's paths with the loaded files
  autosave.js    writing the scene into its file on disk, by itself
  watch.js       noticing that a file changed underneath
  storage.js     autosave into IndexedDB
  main.js        the glue
  ui/            dom, stage, timeline, inspector, outliner, assets, project,
                 export, json, shortcuts, dropzone, modal, status
  export/        gif (own encoder), zip, orchestrator
demo/            example scene and art, generated by tools/
```

`anim.js` and `render.js` touch no DOM beyond the canvas: they are the same
formulas an offline renderer can reimplement to produce the same frame pixel
for pixel.

The demo art is drawn by `tools/make_demo_assets.py` (Pillow, deterministic).
There is nothing third-party in the repository.

## Running it locally

```bash
npm run serve
```

and open `http://127.0.0.1:8000/`. Any static server will do; one is needed
because ES modules will not load from `file://`.

## Tests

```bash
node --test           # the logic
npx playwright test   # the interface, in a real browser
```

No dependencies and no configuration: Node's own runner, over the modules that
do not touch the DOM, which are the ones holding the logic anybody actually
gets wrong. Export gains the most: the GIF is **decoded again** with an LZW
decompressor written separately, so encoder and decompressor have to agree on
something external to both — including the case where the dictionary fills up
mid-frame — and the zip has its signatures, its central-directory offsets and a
CRC-32 of published value checked.

The Playwright ones cover the rest, which is where every real bug has come
from: that nothing invisible covers the canvas, that typing in the inspector
does not steal your caret, that dragging a thumbnail is not mistaken for
dropping files, that the preview appears and goes away, that the exported GIF
starts with `GIF89a`, that the scene survives a reload. Every one of them was
born of a bug that made it to production.

Autosave to disk is tested in both places: the queue under `node --test` — a
downpour of edits is *one* write, two never overlap, one that lands mid-write is
not lost, a failure stops it rather than retrying — and the wiring under
Playwright, with the write replaced by a spy, because the browser will not open
a directory picker from a test. The watcher goes the same way: the ring and the
batches in Node — including that a sprite caught half written keeps counting as
changed until somebody manages to read it — and in Playwright a fake `handle`
whose bytes are swapped underneath it.

And the example scene has its own, because it shipped with three layers that
jumped and a bird that flew backwards: that every layer and every cycle closes,
that no actor jumps while on screen, that layers run faster the nearer they are,
and that frame 0 and frame `loop_frames` are **the same picture pixel for
pixel**, drawn by the real renderer.

The trick that makes them reliable is `window.editor`: the application exposes
its own state, so a test checks `store.scene.actors[0].delay` instead of
guessing from the DOM. And the inspector fields carry `data-field`, so a test
names the one it means instead of counting `input`s and getting it nearly right.

## Licence

MIT.
