# JS-3D-Engine: A Zero-Dependency Rasterizer

A single-page 3D tool built in plain JavaScript with **no WebGL** and **no external math libraries** — it rasterizes triangles directly to a `<canvas>`.

## Features

- **Custom OBJ parser** (`v` + `f`, triangulation, negative indices)
- **Scene graph** with per-object `position / rotation / scale`
- **Phong-ish lighting** (ambient + diffuse + optional specular)
- **Multi-object editor**: load multiple `.obj` files, select objects, and edit transforms
- **Wireframe / normals / bounds** debug modes + **selected-object highlight**
- **Export OBJ** (exports the current mesh data)

## Usage

- Open `index.html` in a browser.
- Use **Load .obj** to upload any `.obj` file and render it instantly.
- Use the **Scene List** (left) to select/delete objects.
- Use the **Inspector** (right) to move/rotate/scale the selected object.

## Deploy to Vercel

This repo is static — deploy as **Framework Preset: Other** and **Root Directory: `./`**.

## Credits

- Original penguin model: [penger-obj](https://github.com/Max-Kawula/penger-obj)

## Repo layout

- `index.html` / `index.js` / `style.css`: the app
- `assets/penguin.obj`: default model loaded on startup
- `assets/cube.obj`: optional example model
