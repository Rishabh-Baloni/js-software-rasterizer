# JS-Software-Rasterizer

<p align="center">
  A zero‑dependency 3D viewer and editor that rasterizes triangles directly to HTML5 Canvas — no WebGL, no external math libs.
  Load OBJ models, arrange multiple objects, and inspect them with lighting, wireframe and bounds overlays.
</p>

## Highlights

- Tech: Vanilla JS, HTML, Canvas 2D — zero dependencies
- OBJ Loader: supports `v`, `f`, triangulation, negative indices
- Scene Graph: per‑object position, rotation, scale
- Lighting: ambient + diffuse + optional specular highlight
- Multi‑Object: load multiple models, select and edit transforms
- Debug Views: wireframe, normals, bounding boxes, selected highlight
- Export/Share: snapshot PNG and export cleaned OBJ

## Features

### Core Operations

- Load `.obj` files via the top bar (multiple at once works)
- Scene List to select/delete objects
- Inspector to move/rotate/scale the selected object
- Reset View to restore camera and the default penguin + cube layout

### Visual Feedback

- Wireframe overlay
- Per‑triangle normals (toggle)
- Bounding boxes for each object
- Selected‑object outline

### Controls

- Mouse drag: look around
- Mouse wheel: dolly forward/back
- Keyboard: `W/A/S/D` strafe/forward/back, `Q/E` down/up

## How It Works

1. Model transforms (scale → rotate X/Y/Z → translate)
2. View transform (inverse camera)
3. Perspective projection via `(x/z, y/z)` with aspect correction
4. Backface culling in view space
5. Painter’s algorithm (sort triangles far → near) and fill
6. Optional specular highlight using a simple Phong‑ish term

## Getting Started

1. Clone the repo
2. Open `public/index.html` in a browser
3. Load an OBJ and start editing

## Deployment

- Vercel: Framework Preset “Other”, set Root Directory to `public/`
- Assets load from `./assets` relative to `public/`
- `vercel.json` uses clean URLs; no build step required

## Project Structure

```
public/
  index.html
  index.js
  style.css
  assets/
    penguin.obj
    cube.obj
```

## Credits

- Penguin model: https://github.com/Max-Kawula/penger-obj

## License

MIT
