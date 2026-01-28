const BACKGROUND = "#101010";
const FOREGROUND = "#50FF50";
const SELECTED_WIREFRAME = "#ffd400";

const game = document.getElementById("game");
const ctx = game.getContext("2d");

function resizeCanvasToDisplaySize() {
    // Match the CSS pixel size * devicePixelRatio for crisp rendering.
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = Math.max(1, Math.floor(game.clientWidth || window.innerWidth));
    const cssH = Math.max(1, Math.floor(game.clientHeight || window.innerHeight));
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);

    if (game.width !== w) game.width = w;
    if (game.height !== h) game.height = h;
}

window.addEventListener("resize", resizeCanvasToDisplaySize);
resizeCanvasToDisplaySize();

function clear() {
    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, game.width, game.height)
}

function line(p1, p2) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = FOREGROUND;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
}

function screen(p) {
    // -1..1 => 0..2 => 0..1 => 0..w
    return {
        x: (p.x + 1)/2*game.width,
        y: (1 - (p.y + 1)/2)*game.height,
    }
}

function project({x, y, z}) {
    // Near-plane clip: prevents x/z explosions when camera gets too close.
    if (z <= NEAR_PLANE) return null;

    // Aspect correction: without this, wide canvases make models look "fat".
    const aspect = game.width / game.height; // width/height
    return {
        x: (x / z) / aspect,
        y: y / z,
    };
}

const FPS = 60;
const NEAR_PLANE = 0.15;

// -------- Vector Math (no libraries) --------
function vsub(a, b) {
    return {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z};
}

function vcross(a, b) {
    return {
        x: a.y*b.z - a.z*b.y,
        y: a.z*b.x - a.x*b.z,
        z: a.x*b.y - a.y*b.x,
    };
}

function vdot(a, b) {
    return a.x*b.x + a.y*b.y + a.z*b.z;
}

function vlen(a) {
    return Math.sqrt(vdot(a, a));
}

function vscale(a, s) {
    return {x: a.x*s, y: a.y*s, z: a.z*s};
}

function vnormalize(a) {
    const l = vlen(a);
    if (l <= 1e-12) return {x: 0, y: 0, z: 0};
    return vscale(a, 1/l);
}

function vadd(a, b) {
    return {x: a.x + b.x, y: a.y + b.y, z: a.z + b.z};
}

function translate_z({x, y, z}, dz) {
    return {x, y, z: z + dz};
}

function rotate_xz({x, y, z}, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
        x: x*c-z*s,
        y,
        z: x*s+z*c,
    };
}

function rotate_yz({x, y, z}, angle) {
    // rotate around X axis
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
        x,
        y: y*c - z*s,
        z: y*s + z*c,
    };
}

function rotate_xy({x, y, z}, angle) {
    // rotate around Z axis
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
        x: x*c - y*s,
        y: x*s + y*c,
        z,
    };
}

// -------- OBJ Asset Pipeline --------
function parseOBJ(text) {
    // Supports:
    // - v x y z
    // - f i j k
    // - f i/j/k ... (we only care about vertex indices)
    // - polygons (triangulated as a fan)
    // - negative indices (relative to end)
    const vertices = [];
    const faces = [];

    const lines = text.split(/\r?\n/);
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;

        const parts = line.split(/\s+/);
        if (parts[0] === "v") {
            if (parts.length < 4) continue;
            vertices.push({
                x: parseFloat(parts[1]),
                y: parseFloat(parts[2]),
                z: parseFloat(parts[3]),
            });
        } else if (parts[0] === "f") {
            if (parts.length < 4) continue; // need at least a triangle

            const idx = [];
            for (let i = 1; i < parts.length; i++) {
                const token = parts[i];
                if (!token) continue;
                const vStr = token.split("/")[0]; // v, or v/vt/vn
                let vi = parseInt(vStr, 10);
                if (Number.isNaN(vi)) continue;

                // OBJ: 1-based; negative means relative to end
                if (vi < 0) vi = vertices.length + vi;
                else vi = vi - 1;

                idx.push(vi);
            }

            // triangulate polygon via fan: (0,i,i+1)
            for (let i = 1; i + 1 < idx.length; i++) {
                faces.push([idx[0], idx[i], idx[i + 1]]);
            }
        }
    }

    return {vs: vertices, fs: faces};
}

function normalizeMesh(mesh) {
    const {vs, fs} = mesh;
    if (!vs || vs.length === 0) return mesh;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of vs) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    const maxDim = Math.max(dx, dy, dz) || 1;

    // Keep it comfortably inside clip space after perspective divide.
    // (Too big => it will clip at the edges when close to camera.)
    const scale = 0.9 / maxDim;

    const nvs = vs.map(v => ({
        x: (v.x - cx) * scale,
        y: (v.y - cy) * scale,
        z: (v.z - cz) * scale,
    }));

    return {
        vs: nvs,
        fs,
        bounds: {
            min: {x: (minX - cx) * scale, y: (minY - cy) * scale, z: (minZ - cz) * scale},
            max: {x: (maxX - cx) * scale, y: (maxY - cy) * scale, z: (maxZ - cz) * scale},
        },
    };
}

// -------- Scene Graph + Camera (MVP-ish pipeline) --------
// Camera looks down +Z in view space (same as your projection x/z, y/z).
const camera = {
    position: {x: 0, y: 0.5, z: -6},
    yaw: 0,   // rotate around Y
    pitch: 0, // rotate around X
};

function applyModel(p, obj) {
    // Scale -> Rotate (X,Y,Z) -> Translate
    const s = obj.scale || {x: 1, y: 1, z: 1};
    let q = {x: p.x*s.x, y: p.y*s.y, z: p.z*s.z};

    const r = obj.rotation || {x: 0, y: 0, z: 0};
    q = rotate_yz(q, r.x);
    q = rotate_xz(q, r.y);
    q = rotate_xy(q, r.z);

    const t = obj.position || {x: 0, y: 0, z: 0};
    return {x: q.x + t.x, y: q.y + t.y, z: q.z + t.z};
}

function applyView(p) {
    // View = inverse(camera transform)
    let q = vsub(p, camera.position);
    q = rotate_xz(q, -camera.yaw);
    q = rotate_yz(q, -camera.pitch);
    return q;
}

// Default layout helper: penguin on the left, cube on the right.
function applyDefaultLayout(objects) {
    for (const obj of objects) {
        if (!obj || !obj.name) continue;
        if (obj.name === "penguin") {
            obj.position = {x: -1.5, y: 0, z: 0};
            obj.rotation = {x: 0, y: 0, z: 0};
            obj.scale = {x: 3, y: 3, z: 3};
        } else if (obj.name === "cube") {
            obj.position = {x: 1.5, y: 0, z: 0};
            obj.rotation = {x: 0, y: 0, z: 0};
            obj.scale = {x: 1.8, y: 1.8, z: 1.8};
        }
    }
}

// Input (WASD + mouse look)
const keysDown = new Set();
window.addEventListener("keydown", (e) => { keysDown.add(e.code); });
window.addEventListener("keyup", (e) => { keysDown.delete(e.code); });

let dragging = false;
let lastMX = 0;
let lastMY = 0;
game.addEventListener("mousedown", (e) => {
    dragging = true;
    lastMX = e.clientX;
    lastMY = e.clientY;
});
window.addEventListener("mouseup", () => { dragging = false; });
window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastMX;
    const dy = e.clientY - lastMY;
    lastMX = e.clientX;
    lastMY = e.clientY;

    const sensitivity = 0.004;
    camera.yaw += dx * sensitivity;
    camera.pitch += dy * sensitivity;

    const limit = Math.PI / 2 - 0.01;
    if (camera.pitch > limit) camera.pitch = limit;
    if (camera.pitch < -limit) camera.pitch = -limit;
});

game.addEventListener("wheel", (e) => {
    // wheel = dolly forward/back (nice for demos)
    e.preventDefault();
    const speed = 0.02;
    const dir = e.deltaY > 0 ? 1 : -1;
    const forward = {x: Math.sin(camera.yaw), y: 0, z: Math.cos(camera.yaw)};
    camera.position = vadd(camera.position, vscale(forward, dir * speed * 20));
}, {passive: false});

const objFile = document.getElementById("objFile");
const resetViewBtn = document.getElementById("resetView");
const statsEl = document.getElementById("stats");
const snapshotBtn = document.getElementById("snapshotBtn");
const exportObjBtn = document.getElementById("exportObjBtn");
const drawWireframeEl = document.getElementById("drawWireframe");
const drawNormalsEl = document.getElementById("drawNormals");
const drawBoundsEl = document.getElementById("drawBounds");
const enableSpecularEl = document.getElementById("enableSpecular");

// Sidebar UI
const sceneListEl = document.getElementById("sceneList");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const posXEl = document.getElementById("posX");
const posYEl = document.getElementById("posY");
const posZEl = document.getElementById("posZ");
const posXNumEl = document.getElementById("posXNum");
const posYNumEl = document.getElementById("posYNum");
const posZNumEl = document.getElementById("posZNum");

const rotXEl = document.getElementById("rotX");
const rotYEl = document.getElementById("rotY");
const rotZEl = document.getElementById("rotZ");
const rotXNumEl = document.getElementById("rotXNum");
const rotYNumEl = document.getElementById("rotYNum");
const rotZNumEl = document.getElementById("rotZNum");

const scaleUEl = document.getElementById("scaleU");
const scaleUNumEl = document.getElementById("scaleUNum");

function resetView() {
    camera.position = {x: 0, y: 0.5, z: -6};
    camera.yaw = 0;
    camera.pitch = 0;
    applyDefaultLayout(sceneObjects);
    syncInspectorFromSelected();
}

if (resetViewBtn) resetViewBtn.addEventListener("click", resetView);
if (snapshotBtn) {
    snapshotBtn.addEventListener("click", () => {
        // Simple sprite export of the current canvas contents.
        const link = document.createElement("a");
        link.download = "3d-render.png";
        link.href = game.toDataURL("image/png");
        link.click();
    });
}
if (exportObjBtn) {
    exportObjBtn.addEventListener("click", () => {
        const mesh = baseMesh || (sceneObjects[0] && sceneObjects[0].mesh);
        if (!mesh || !mesh.vs || !mesh.fs) return;

        let output = "# Exported from 3D Engine Viewer\n";
        for (const v of mesh.vs) {
            output += `v ${v.x} ${v.y} ${v.z}\n`;
        }
        for (const f of mesh.fs) {
            if (f.length < 3) continue;
            output += `f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}\n`;
        }

        const blob = new Blob([output], {type: "text/plain"});
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "fixed_model.obj";
        link.click();
    });
}

let baseMesh = null;       // default penguin mesh
let baseCubeMesh = null;   // default cube mesh
let sceneObjects = [];
let selectedObjectIndex = 0;

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function getSelectedObject() {
    if (!sceneObjects || sceneObjects.length === 0) return null;
    selectedObjectIndex = clamp(selectedObjectIndex, 0, sceneObjects.length - 1);
    return sceneObjects[selectedObjectIndex];
}

let inspectorIsSyncing = false;

function updateSceneListUI() {
    if (!sceneListEl) return;
    sceneListEl.innerHTML = "";

    sceneObjects.forEach((obj, idx) => {
        const btn = document.createElement("button");
        btn.className = "scene-item-btn" + (idx === selectedObjectIndex ? " selected" : "");
        const label = (obj && obj.name) ? obj.name : `Object ${idx + 1}`;
        btn.textContent = `${idx + 1}. ${label}`;
        btn.addEventListener("click", () => {
            selectedObjectIndex = idx;
            updateSceneListUI();
            syncInspectorFromSelected();
        });
        sceneListEl.appendChild(btn);
    });

    if (sceneObjects.length === 0) selectedObjectIndex = 0;
    else selectedObjectIndex = clamp(selectedObjectIndex, 0, sceneObjects.length - 1);
}

function setInputPair(rangeEl, numEl, value) {
    if (rangeEl) rangeEl.value = String(value);
    if (numEl) numEl.value = String(value);
}

function syncInspectorFromSelected() {
    const obj = getSelectedObject();
    if (!obj) return;

    inspectorIsSyncing = true;
    const p = obj.position || (obj.position = {x: 0, y: 0, z: 0});
    const r = obj.rotation || (obj.rotation = {x: 0, y: 0, z: 0});
    const s = obj.scale || (obj.scale = {x: 1, y: 1, z: 1});

    setInputPair(posXEl, posXNumEl, p.x);
    setInputPair(posYEl, posYNumEl, p.y);
    setInputPair(posZEl, posZNumEl, p.z);

    setInputPair(rotXEl, rotXNumEl, r.x);
    setInputPair(rotYEl, rotYNumEl, r.y);
    setInputPair(rotZEl, rotZNumEl, r.z);

    setInputPair(scaleUEl, scaleUNumEl, s.x);
    inspectorIsSyncing = false;

    if (statsEl && obj.mesh && obj.mesh.vs && obj.mesh.fs) {
        statsEl.textContent = `v=${obj.mesh.vs.length}  f(tris)=${obj.mesh.fs.length}`;
    }
}

function bindRangeNumber(rangeEl, numEl, onValue) {
    if (rangeEl) {
        rangeEl.addEventListener("input", () => {
            if (inspectorIsSyncing) return;
            const v = parseFloat(rangeEl.value);
            if (numEl) numEl.value = String(v);
            onValue(v);
        });
    }
    if (numEl) {
        numEl.addEventListener("input", () => {
            if (inspectorIsSyncing) return;
            const v = parseFloat(numEl.value);
            if (rangeEl) rangeEl.value = String(v);
            onValue(v);
        });
    }
}

// Build the default scene: left penguin + right cube, if their meshes are loaded.
function buildDefaultScene() {
    const scene = [];
    if (baseMesh) {
        scene.push({
            name: "penguin",
            mesh: baseMesh,
            position: {x: -1.5, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 3, y: 3, z: 3},
            color: {r: 0, g: 255, b: 0},
        });
    }
    if (baseCubeMesh) {
        scene.push({
            name: "cube",
            mesh: baseCubeMesh,
            position: {x: 1.5, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 1.8, y: 1.8, z: 1.8},
            color: {r: 80, g: 200, b: 255},
        });
    }
    applyDefaultLayout(scene);
    return scene;
}

// Default meshes: load bundled OBJ assets (Vercel/GitHub Pages friendly).
(async () => {
    try {
        const [pengRes, cubeRes] = await Promise.all([
            fetch("/public/assets/penguin.obj"),
            fetch("/public/assets/cube.obj"),
        ]);

        if (!pengRes.ok) throw new Error(`Failed to load penguin asset: ${pengRes.status}`);
        const pengText = await pengRes.text();
        baseMesh = normalizeMesh(parseOBJ(pengText));

        if (cubeRes.ok) {
            const cubeText = await cubeRes.text();
            baseCubeMesh = normalizeMesh(parseOBJ(cubeText));
        }

        sceneObjects = buildDefaultScene();
        selectedObjectIndex = 0;
        updateSceneListUI();
        syncInspectorFromSelected();

        if (statsEl && baseMesh) {
            statsEl.textContent = `v=${baseMesh.vs.length}  f(tris)=${baseMesh.fs.length}`;
        }
    } catch (e) {
        // If the assets are missing, the app still works (user can upload an OBJ).
        if (statsEl) statsEl.textContent = "Upload an .obj to begin";
        // eslint-disable-next-line no-console
        console.warn(e);
    }
})();

if (objFile) {
    objFile.addEventListener("change", async () => {
        const file = objFile.files && objFile.files[0];
        if (!file) return;

        const text = await file.text();
        const parsed = parseOBJ(text);
        const mesh = normalizeMesh(parsed);

        // Dynamic loading: do NOT clear sceneObjects; push new object and select it.
        sceneObjects.push({
            name: file.name || `Object ${sceneObjects.length + 1}`,
            mesh,
            position: {x: 0, y: 0, z: 0},
            rotation: {x: 0, y: 0, z: 0},
            scale: {x: 1, y: 1, z: 1},
            color: {r: 0, g: 255, b: 0},
        });
        selectedObjectIndex = sceneObjects.length - 1;
        updateSceneListUI();
        syncInspectorFromSelected();
        resetView();
        objFile.value = "";
    });
}

// Scene list actions
if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener("click", () => {
        if (!sceneObjects || sceneObjects.length === 0) return;
        selectedObjectIndex = clamp(selectedObjectIndex, 0, sceneObjects.length - 1);
        sceneObjects.splice(selectedObjectIndex, 1);

        if (sceneObjects.length === 0) {
            sceneObjects = buildDefaultScene();
            selectedObjectIndex = 0;
        } else {
            selectedObjectIndex = clamp(selectedObjectIndex, 0, sceneObjects.length - 1);
        }

        updateSceneListUI();
        syncInspectorFromSelected();
    });
}

if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
        sceneObjects = buildDefaultScene();
        selectedObjectIndex = 0;
        updateSceneListUI();
        syncInspectorFromSelected();
    });
}

// Inspector bindings (two-way)
bindRangeNumber(posXEl, posXNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    (obj.position || (obj.position = {x: 0, y: 0, z: 0})).x = v;
});
bindRangeNumber(posYEl, posYNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    (obj.position || (obj.position = {x: 0, y: 0, z: 0})).y = v;
});
bindRangeNumber(posZEl, posZNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    (obj.position || (obj.position = {x: 0, y: 0, z: 0})).z = v;
});

bindRangeNumber(rotXEl, rotXNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    (obj.rotation || (obj.rotation = {x: 0, y: 0, z: 0})).x = v;
});
bindRangeNumber(rotYEl, rotYNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    (obj.rotation || (obj.rotation = {x: 0, y: 0, z: 0})).y = v;
});
bindRangeNumber(rotZEl, rotZNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    (obj.rotation || (obj.rotation = {x: 0, y: 0, z: 0})).z = v;
});

bindRangeNumber(scaleUEl, scaleUNumEl, (v) => {
    const obj = getSelectedObject(); if (!obj) return;
    const s = obj.scale || (obj.scale = {x: 1, y: 1, z: 1});
    s.x = v; s.y = v; s.z = v;
});

function frame() {
    const dt = 1/FPS;
    resizeCanvasToDisplaySize();
    clear()

    // Camera is at origin looking down +Z (because we project with x/z, y/z).
    // Light is directional in camera space.
    const lightDir = vnormalize({x: -1, y: 1, z: -1});
    const ambient = 0.15;
    const shininess = 64;

    // Move camera (WASD) in world space
    {
        const moveSpeed = (keysDown.has("ShiftLeft") || keysDown.has("ShiftRight")) ? 8 : 4;
        const forward = {x: Math.sin(camera.yaw), y: 0, z: Math.cos(camera.yaw)};
        const right = {x: Math.cos(camera.yaw), y: 0, z: -Math.sin(camera.yaw)};
        if (keysDown.has("KeyW")) camera.position = vadd(camera.position, vscale(forward, moveSpeed * dt));
        if (keysDown.has("KeyS")) camera.position = vadd(camera.position, vscale(forward, -moveSpeed * dt));
        if (keysDown.has("KeyD")) camera.position = vadd(camera.position, vscale(right, moveSpeed * dt));
        if (keysDown.has("KeyA")) camera.position = vadd(camera.position, vscale(right, -moveSpeed * dt));
        if (keysDown.has("KeyE")) camera.position = vadd(camera.position, {x: 0, y: moveSpeed * dt, z: 0});
        if (keysDown.has("KeyQ")) camera.position = vadd(camera.position, {x: 0, y: -moveSpeed * dt, z: 0});
    }

    const drawWireframe = !!(drawWireframeEl && drawWireframeEl.checked);
    const drawNormals = !!(drawNormalsEl && drawNormalsEl.checked);
    const drawBounds = !!(drawBoundsEl && drawBoundsEl.checked);
    const enableSpecular = !!(enableSpecularEl && enableSpecularEl.checked);

    // Build GLOBAL triangle list across all objects (fixes multi-object sorting)
    const tris = [];
    for (let objIndex = 0; objIndex < sceneObjects.length; objIndex++) {
        const obj = sceneObjects[objIndex];
        if (!obj.mesh || !obj.mesh.vs || !obj.mesh.fs) continue;
        const vsLocal = obj.mesh.vs;
        const fsLocal = obj.mesh.fs;

        for (const f of fsLocal) {
            if (f.length !== 3) continue;
            const a0 = vsLocal[f[0]];
            const b0 = vsLocal[f[1]];
            const c0 = vsLocal[f[2]];
            if (!a0 || !b0 || !c0) continue;

            // Model -> World
            const aW = applyModel(a0, obj);
            const bW = applyModel(b0, obj);
            const cW = applyModel(c0, obj);

            // World -> View (camera space)
            const a = applyView(aW);
            const b = applyView(bW);
            const c = applyView(cW);

            // Near-plane guard (in view space)
            if (a.z <= 1e-6 || b.z <= 1e-6 || c.z <= 1e-6) continue;

            // Normal in view space
            const ab = vsub(b, a);
            const ac = vsub(c, a);
            const n = vcross(ab, ac);

            // Backface culling in view space
            if (vdot(n, a) >= 0) continue;
            const nn = vnormalize(n);

            // Lighting in view space
            let diffuse = 1;
            let spec = 0;
            if (!obj.unlit) {
                diffuse = vdot(nn, lightDir);
                if (diffuse < 0) diffuse = 0;
                diffuse = ambient + (1 - ambient) * diffuse;

                if (enableSpecular && diffuse > ambient) {
                    const L = vnormalize(vscale(lightDir, -1)); // from light to surface
                    const NL = vdot(nn, L);
                    const R = vnormalize(vsub(vscale(nn, 2 * NL), L));
                    const center = vscale({x: a.x + b.x + c.x, y: a.y + b.y + c.y, z: a.z + b.z + c.z}, 1/3);
                    const V = vnormalize(vscale(center, -1)); // center -> camera
                    const rv = vdot(R, V);
                    if (rv > 0) spec = Math.pow(rv, shininess);
                }
            }

            const avgZ = (a.z + b.z + c.z) / 3;
            tris.push({a, b, c, avgZ, diffuse, spec, nn, color: obj.color || {r: 0, g: 255, b: 0}, objIndex});
        }
    }

    // Painter's algorithm: far -> near (global)
    tris.sort((t1, t2) => t2.avgZ - t1.avgZ);

    // Rasterize (fill) + optional wireframe overlay
    for (const t of tris) {
        const pA = project(t.a);
        const pB = project(t.b);
        const pC = project(t.c);
        if (!pA || !pB || !pC) continue;

        const A = screen(pA);
        const B = screen(pB);
        const C = screen(pC);

        const base = t.color || {r: 0, g: 255, b: 0};
        const s = 255 * t.spec;
        const r = base.r * t.diffuse + s;
        const g = base.g * t.diffuse + s;
        const bcol = base.b * t.diffuse + s;
        const rr = Math.max(0, Math.min(255, Math.round(r)));
        const gg = Math.max(0, Math.min(255, Math.round(g)));
        const bb = Math.max(0, Math.min(255, Math.round(bcol)));
        ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;

        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.lineTo(C.x, C.y);
        ctx.closePath();
        ctx.fill();

        if (drawWireframe) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = (t.objIndex === selectedObjectIndex) ? SELECTED_WIREFRAME : "#f0f0f0";
            ctx.stroke();
        }

        if (drawNormals) {
            const center = {
                x: (t.a.x + t.b.x + t.c.x) / 3,
                y: (t.a.y + t.b.y + t.c.y) / 3,
                z: (t.a.z + t.b.z + t.c.z) / 3,
            };
            const tip = vadd(center, vscale(t.nn, 0.15));
            const pc = project(center);
            const pt = project(tip);
            if (pc && pt) {
                const C0 = screen(pc);
                const C1 = screen(pt);
                ctx.lineWidth = 2;
                ctx.strokeStyle = "#ff4040";
                ctx.beginPath();
                ctx.moveTo(C0.x, C0.y);
                ctx.lineTo(C1.x, C1.y);
                ctx.stroke();
            }
        }
    }

    if (drawBounds) {
        const edges = [
            [0,1],[1,2],[2,3],[3,0],
            [4,5],[5,6],[6,7],[7,4],
            [0,4],[1,5],[2,6],[3,7],
        ];
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(120,180,255,0.9)";

        for (const obj of sceneObjects) {
            if (!obj.mesh || !obj.mesh.bounds) continue;
            const bmin = obj.mesh.bounds.min;
            const bmax = obj.mesh.bounds.max;
            const cornersLocal = [
                {x: bmin.x, y: bmin.y, z: bmin.z},
                {x: bmax.x, y: bmin.y, z: bmin.z},
                {x: bmax.x, y: bmax.y, z: bmin.z},
                {x: bmin.x, y: bmax.y, z: bmin.z},
                {x: bmin.x, y: bmin.y, z: bmax.z},
                {x: bmax.x, y: bmin.y, z: bmax.z},
                {x: bmax.x, y: bmax.y, z: bmax.z},
                {x: bmin.x, y: bmax.y, z: bmax.z},
            ];

            for (const [i, j] of edges) {
                const aW = applyModel(cornersLocal[i], obj);
                const bW = applyModel(cornersLocal[j], obj);
                const a = applyView(aW);
                const b = applyView(bW);
                const pa = project(a);
                const pb = project(b);
                if (!pa || !pb) continue;
                const A = screen(pa);
                const B = screen(pb);
                ctx.beginPath();
                ctx.moveTo(A.x, A.y);
                ctx.lineTo(B.x, B.y);
                ctx.stroke();
            }
        }
    }
    setTimeout(frame, 1000/FPS);
}
setTimeout(frame, 1000/FPS);
