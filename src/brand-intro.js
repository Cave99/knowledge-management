// Original KM flow logo rig, adapted from the supplied demo. Loaded only on replay.
export function playIntro(canvas, brandLogo, backdrop, onComplete) {


/* ════════════════════════════════════════════════════════════════════
   1. LOGO GEOMETRY (KM flow, vector outlines from Outfit 500).
   Piece IDs retain the original motion rig's six slots.
   ════════════════════════════════════════════════════════════════════ */
const GLY = {"O": {"d": "M53.89 90 12.61 43.07 53 0H71.73L30.88 42.88L73 90ZM0 90V0H14.65V90Z", "b": [0.0, 0.0, 73.0, 89.99999999999999]}, "K": {"d": "M85 90V0H93.64L125.06 61.59H119.44L150.86 0H159.5V90H147.08V25.97L149.89 26.87L126.57 72.51H117.93L94.61 26.87L97.42 25.97V90Z", "b": [85.0, 0.0, 159.5, 89.99999999999999]}, "F": {"d": "M33.55 140V110.52Q33.55 107.54 34.88 105.26Q36.21 102.98 38.57 101.67Q40.94 100.37 44.03 100.37Q46.42 100.37 48.1 101.19Q49.78 102 51.25 103.52L47.4 107.37Q46.74 106.72 45.98 106.34Q45.22 105.96 44.03 105.96Q41.86 105.96 40.69 107.13Q39.52 108.3 39.52 110.47V140ZM27.31 119.37V113.94H47.4V119.37Z", "b": [27.310000000000006, 100.37142857142857, 51.25000000000001, 140.0]}, "l": {"d": "M51.85 140V100.91H57.82V140Z", "b": [51.84714285714286, 100.91428571428571, 57.81857142857143, 140.0]}, "o": {"d": "M76.38 140.54Q72.58 140.54 69.49 138.72Q66.4 136.91 64.58 133.81Q62.76 130.72 62.76 126.92Q62.76 123.12 64.58 120.08Q66.4 117.04 69.49 115.22Q72.58 113.4 76.38 113.4Q80.24 113.4 83.33 115.19Q86.43 116.98 88.25 120.05Q90.06 123.12 90.06 126.92Q90.06 130.72 88.25 133.81Q86.43 136.91 83.33 138.72Q80.24 140.54 76.38 140.54ZM76.38 134.79Q78.61 134.79 80.32 133.78Q82.03 132.78 82.98 130.99Q83.93 129.2 83.93 126.92Q83.93 124.64 82.95 122.9Q81.98 121.16 80.29 120.16Q78.61 119.15 76.38 119.15Q74.21 119.15 72.5 120.16Q70.79 121.16 69.84 122.9Q68.89 124.64 68.89 126.92Q68.89 129.2 69.84 130.99Q70.79 132.78 72.5 133.78Q74.21 134.79 76.38 134.79Z", "b": [62.758571428571436, 113.4, 90.06428571428572, 140.54285714285714]}, "w": {"d": "M102.6 140 92.13 113.94H98.32L105.37 132.89L103.53 132.94L110.42 113.94H113.9L120.79 132.94L118.94 132.89L126 113.94H132.19L121.71 140H118.24L111.18 121.98H113.14L106.08 140Z", "b": [92.12714285714287, 113.94285714285715, 132.19, 140.0]}};
const LOGO_W = 159.5, LOGO_H = 141;
const PIECES = [
  { id:"O", d:GLY.O.d, b:GLY.O.b, anc:[50,50] },
  ...["K","F","l","o","w"].map(id => {
    const b = GLY[id].b; return { id, d:GLY[id].d, b, anc:[(b[0]+b[2])/2, (b[1]+b[3])/2] };
  })
];
const PI_ = Object.fromEntries(PIECES.map((p,i) => [p.id, i]));
const logoMarkup = PIECES.map(p => `<path d="${p.d}"${p.eo ? ' fill-rule="evenodd"' : ''}/>`).join("");


/* ════════════════════════════════════════════════════════════════════
   2. MATHS + MOTION PRIMITIVES
   ════════════════════════════════════════════════════════════════════ */
const { sin, cos, exp, sqrt, atan2, hypot, min, max, abs, PI } = Math;
const clamp = (x, a=0, b=1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
/* closed-form damped spring step response: 0 → 1 with natural overshoot */
function spr(t, f = 2, z = 0.5) {
  if (t <= 0) return 0;
  const w = 2 * PI * f;
  if (z < 1) { const wd = w * sqrt(1 - z * z); return 1 - exp(-z * w * t) * (cos(wd * t) + (z * w / wd) * sin(wd * t)); }
  return 1 - exp(-w * t) * (1 + w * t);
}
/* CSS-style cubic-bezier easing */
function bez(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, Cc = a => 3 * a;
  const f = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + Cc(a)) * t;
  const df = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + Cc(a);
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x; for (let i = 0; i < 6; i++) { const d = df(t, x1, x2); if (abs(d) < 1e-6) break; t -= (f(t, x1, x2) - x) / d; }
    return f(clamp(t), y1, y2);
  };
}
const flyEase = bez(.5, 0, .38, 1);
const hash = i => { const s = sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/* ════════════════════════════════════════════════════════════════════
   3. SDF ATLAS: each logo piece is rasterised once and turned into an exact
   signed distance field (Felzenszwalb EDT, TinySDF-style subpixel seeding),
   so the shader draws the real logo pixel-perfect and can melt it.
   ════════════════════════════════════════════════════════════════════ */
const TPU = 6, PAD = 14, INF = 1e20;
function edt1d(g, off, stride, n, f, v, z) {
  v[0] = 0; z[0] = -INF; z[1] = INF; f[0] = g[off];
  for (let q = 1, k = 0, s = 0; q < n; q++) {
    f[q] = g[off + q * stride]; const q2 = q * q;
    do { const r = v[k]; s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2; } while (s <= z[k] && --k > -1);
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = v[k], qr = q - r; g[off + q * stride] = f[r] + qr * qr; }
}
function edt(g, w, h) {
  const n = max(w, h), f = new Float64Array(n), v = new Uint16Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) edt1d(g, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(g, y * w, 1, w, f, v, z);
}
function buildAtlas() {
  const cells = []; let W = 0, H = 0;
  for (const p of PIECES) {
    const cw = Math.ceil((p.b[2] - p.b[0] + 2 * PAD) * TPU), ch = Math.ceil((p.b[3] - p.b[1] + 2 * PAD) * TPU);
    cells.push({ x: W, cw, ch }); W += cw + 2; H = max(H, ch);
  }
  const data = new Float32Array(W * H).fill(PAD);
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
  PIECES.forEach((p, i) => {
    const c = cells[i]; cv.width = c.cw; cv.height = c.ch;
    ctx.setTransform(TPU, 0, 0, TPU, (PAD - p.b[0]) * TPU, (PAD - p.b[1]) * TPU);
    ctx.fill(new Path2D(p.d), p.eo ? "evenodd" : "nonzero");
    const a = ctx.getImageData(0, 0, c.cw, c.ch).data, n = c.cw * c.ch;
    const go = new Float64Array(n), gi = new Float64Array(n);
    for (let j = 0; j < n; j++) { const inside = a[j * 4 + 3] >= 128; go[j] = inside ? 0 : INF; gi[j] = inside ? INF : 0; }
    edt(go, c.cw, c.ch); edt(gi, c.cw, c.ch);
    for (let y = 0; y < c.ch; y++) for (let x = 0; x < c.cw; x++) {
      const j = y * c.cw + x; data[y * W + c.x + x] = (go[j] > 0 ? sqrt(go[j]) - .5 : .5 - sqrt(gi[j])) / TPU;
    }
    c.anc = [p.anc[0] - p.b[0] + PAD, p.anc[1] - p.b[1] + PAD];
    c.wu = c.cw / TPU; c.hu = c.ch / TPU;
    c.rad = hypot(max(c.anc[0], c.wu - c.anc[0]), max(c.anc[1], c.hu - c.anc[1])) - PAD;
  });
  return { data, W, H, cells };
}

/* ════════════════════════════════════════════════════════════════════
   4. WEBGL2 RENDERER: one fragment shader, flat brand colour, no gloss.
   ════════════════════════════════════════════════════════════════════ */
const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform vec2 uAtlasSize;
uniform vec2 uRes; uniform float uDpr, uTime;
uniform vec4 uPA[6];   // pos.xy, distScale, circleMorph
uniform vec4 uPM[6];   // inverse transform (px -> units)
uniform vec4 uPC[6];   // droplet radius px, mode (0 off · 1 morph · 2 glyph∪droplet · 3 droplet · 4 iris morph), opacity, iris hole radius (units)
uniform vec4 uCell[6]; // atlas x (texels), unused, cell w, h (units)
uniform vec2 uAnc[6];
uniform float uKL;     // goo radius between logo pieces
uniform vec4 uAX; uniform vec2 uAS;   // arrow frame: centre, angle | scale x,y
uniform vec4 uCap[5]; uniform vec2 uCapR[5]; uniform float uKA, uArrowOn;
uniform vec3 uTr[14]; uniform float uKT;
uniform vec4 uW;       // wobble px, noise freq, ripple amp px, ripple phase
uniform vec2 uBC;      // ripple centre
uniform vec3 uCol;
out vec4 outCol;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float smin(float a, float b, float k){ if (k < .01) return min(a, b); float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
float sdCap(vec2 p, vec4 ab, vec2 rr){
  if (rr.x <= 0. && rr.y <= 0.) return 1e5;
  vec2 a = ab.xy, b = ab.zw, ba = b - a; float h = length(ba); vec2 q = p - a;
  if (h < .001) return length(q) - max(rr.x, rr.y);
  vec2 dir = ba / h; vec2 pp = vec2(abs(dot(q, vec2(-dir.y, dir.x))), dot(q, dir));
  float bb = clamp((rr.x - rr.y) / h, -.98, .98), aa = sqrt(1. - bb * bb), k = dot(pp, vec2(-bb, aa));
  if (k < 0.) return length(pp) - rr.x;
  if (k > aa * h) return length(pp - vec2(0., h)) - rr.y;
  return dot(pp, vec2(aa, bb)) - rr.x;
}
float piece(int i, vec2 p){
  vec4 A = uPA[i]; vec2 q = p - A.xy; vec4 M = uPM[i]; vec4 c = uCell[i];
  float mode = uPC[i].y, dc = length(q) - uPC[i].x;
  if (mode > 2.5 && mode < 3.5) return dc;
  vec2 l = vec2(M.x * q.x + M.z * q.y, M.y * q.x + M.w * q.y) + uAnc[i];
  vec2 lc = clamp(l, vec2(.5 / ${TPU.toFixed(1)}), c.zw - .5 / ${TPU.toFixed(1)});
  float d = texture(uAtlas, (vec2(c.x, 0.) + lc * ${TPU.toFixed(1)}) / uAtlasSize).r + length(l - lc);
  d *= A.z;
  if (mode > 1.5 && mode < 2.5) return uPC[i].x > .05 ? smin(d, dc, uPC[i].x * .6 + 1.) : d;
  return A.w > 0. ? mix(d, dc, A.w) : d;
}
float scene(vec2 p){
  if (uW.x > .01){
    vec2 wq = p * uW.y;
    vec2 w = vec2(vnoise(wq + vec2(0., uTime * .45)), vnoise(wq + vec2(5.2, 1.3) - vec2(uTime * .38, 0.))) - .5;
    p += w * 2. * uW.x;
  }
  float d = 1e5;
  for (int i = 0; i < 6; i++) if (uPC[i].y > .5 && uPC[i].z > .999) d = smin(d, piece(i, p), uKL);
  if (uArrowOn > .5){
    vec2 q = p - uAX.xy; float c = cos(uAX.z), s = sin(uAX.z);
    vec2 l = vec2(c * q.x + s * q.y, -s * q.x + c * q.y) / uAS;
    float da = min(min(sdCap(l, uCap[0], uCapR[0]), sdCap(l, uCap[1], uCapR[1])), sdCap(l, uCap[2], uCapR[2]));
    da = smin(da, sdCap(l, uCap[3], uCapR[3]), uKA);
    da = smin(da, sdCap(l, uCap[4], uCapR[4]), uKA);
    d = smin(d, da * min(uAS.x, uAS.y), uKL);
  }
  if (uKT > .01){
    float dt = 1e5;
    for (int i = 0; i < 14; i++) if (uTr[i].z > .05) dt = smin(dt, length(p - uTr[i].xy) - uTr[i].z, uKT * .7);
    d = smin(d, dt, uKT);
  }
  if (uW.z > .01){ vec2 rc = p - uBC; float an = atan(rc.y, rc.x); d += uW.z * (sin(an * 5. - uW.w) + .6 * sin(an * 3. + uW.w * 1.3)); }
  return d;
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float a = clamp(.5 - scene(p) * uDpr, 0., 1.);
  for (int i = 0; i < 6; i++) if (uPC[i].y > .5 && uPC[i].z < .999) a = max(a, clamp(.5 - piece(i, p) * uDpr, 0., 1.) * uPC[i].z);
  outCol = vec4(uCol * a, a);
}`;


let gl = null, U = {}, ATLAS = null;
function initGL() {
  if (new URLSearchParams(location.search).has("nogl")) return false;
  gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return false;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(o)); return null; } return o; };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return (gl = null, false);
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(pr)); return (gl = null, false); }
  gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const al = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
  for (const n of ["uAtlas","uAtlasSize","uRes","uDpr","uTime","uKL","uAX","uAS","uKA","uArrowOn","uKT","uW","uBC","uCol"]) U[n] = gl.getUniformLocation(pr, n);
  for (const n of ["uPA","uPM","uPC","uCell","uAnc","uCap","uCapR","uTr"]) U[n] = gl.getUniformLocation(pr, n + "[0]");
  ATLAS = buildAtlas();
  const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, ATLAS.W, ATLAS.H, 0, gl.RED, gl.FLOAT, ATLAS.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uAtlas, 0); gl.uniform2f(U.uAtlasSize, ATLAS.W, ATLAS.H);
  const cell = new Float32Array(24), anc = new Float32Array(12);
  ATLAS.cells.forEach((c, i) => { cell.set([c.x, 0, c.wu, c.hu], i * 4); anc.set(c.anc, i * 2); });
  gl.uniform4fv(U.uCell, cell); gl.uniform2fv(U.uAnc, anc);
  gl.enable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0);
  return true;
}

/* ════════════════════════════════════════════════════════════════════
   5. LAYOUT: everything is derived from the viewport + the real sidebar logo
   ════════════════════════════════════════════════════════════════════ */

const L = {};
function layout() {
  L.vw = innerWidth; L.vh = innerHeight; L.dpr = min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(L.vw * L.dpr); canvas.height = Math.round(L.vh * L.dpr);
  L.S0 = clamp(L.vw * .19, 150, 280) / LOGO_W;            // px per logo unit, hero
  L.C = [L.vw / 2, L.vh / 2];
  L.Rb = 47 * L.S0;                                         // the ball: a bit under the O's radius
  const r = brandLogo.getBoundingClientRect();
  L.S1 = r.width / LOGO_W; L.T0 = [r.left, r.top];          // small logo origin + scale
  L.TO = [r.left + 50 * L.S1, r.top + 50 * L.S1];           // small O centre = landing point
  L.Rs = 47 * L.S1;
  buildPath();
}
/* flight path: a short run right, one rising half-loop, then a long glide to the corner */
function buildPath() {
  const C = L.C, T = L.TO, pts = [];
  const narrow = L.vw < 600, run = narrow ? min(L.vw * .05, 24) : min(L.vw * .1, 150);
  const Q = [C[0] + run, C[1]];
  let R = clamp((C[1] - T[1]) * .36, 60, 230); R = max(40, min(R, L.vw - Q[0] - (narrow ? 90 : 40))); L.loopR = R;
  for (let i = 0; i <= 24; i++) pts.push(lerp2(C, Q, i / 24));
  for (let i = 1; i <= 90; i++) { const th = PI / 2 - PI * i / 90; pts.push([Q[0] + R * cos(th), Q[1] - R + R * sin(th)]); }
  const Uu = [Q[0], Q[1] - 2 * R], dx = Uu[0] - T[0], dy = Uu[1] - T[1];
  const P1 = [Uu[0] - dx * .45, Uu[1]], P2 = [T[0] + dx * .32, T[1] + dy * .18];
  for (let i = 1; i <= 120; i++) {
    const t = i / 120, mt = 1 - t;
    pts.push([mt*mt*mt*Uu[0] + 3*mt*mt*t*P1[0] + 3*mt*t*t*P2[0] + t*t*t*T[0], mt*mt*mt*Uu[1] + 3*mt*mt*t*P1[1] + 3*mt*t*t*P2[1] + t*t*t*T[1]]);
  }
  L.path = arcLen(pts);
  // "Direct": no loop. One gentle arc, rising slightly right then sweeping into the corner
  const D1 = [C[0] + L.vw * .04, C[1] - (C[1] - T[1]) * .5], D2 = [T[0] + (C[0] - T[0]) * .35, T[1] + (C[1] - T[1]) * .05], dp = [];
  for (let i = 0; i <= 160; i++) {
    const t = i / 160, mt = 1 - t;
    dp.push([mt*mt*mt*C[0] + 3*mt*mt*t*D1[0] + 3*mt*t*t*D2[0] + t*t*t*T[0], mt*mt*mt*C[1] + 3*mt*mt*t*D1[1] + 3*mt*t*t*D2[1] + t*t*t*T[1]]);
  }
  L.pathD = arcLen(dp);
}
function arcLen(pts) {
  const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, acc, len: acc[acc.length - 1] };
}
const curPath = () => cfg.variant === "direct" ? L.pathD : L.path;
function pathAt(u) {
  const P = curPath();
  if (u <= 0) return [P.pts[0][0] + u * P.len, P.pts[0][1]];
  if (u >= 1) return P.pts[P.pts.length - 1].slice();
  const s = u * P.len; let lo = 0, hi = P.acc.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.acc[m] < s) lo = m; else hi = m; }
  const f = (s - P.acc[lo]) / (P.acc[hi] - P.acc[lo] || 1);
  return lerp2(P.pts[lo], P.pts[hi], f);
}

/* ════════════════════════════════════════════════════════════════════
   6. TIMELINE: the whole intro is a pure function of (t, authAt), so it can
   be scrubbed, slowed, and waits seamlessly for auth in the idle state.
   ════════════════════════════════════════════════════════════════════ */
const cfg = { speed: 1, auth: 0, mode: "full", motion: "full", theme: "auto", variant: "direct" };
/* blob → arrow transition variants (toggle in the playground).
   goMin: earliest moment the arrow may take over (full / returning). pre: delay before it starts flying.
   Anything that takes over before the melt has settled keeps the melt running and pours it into the arrow. */
const VARIANTS = {
  original: { label: "Baseline",     goMin: 2.5,  goMinS: .36, pre: .44, ease: bez(.5, 0, .38, 1) },
  flow:     { label: "Flow-through", goMin: 2.2,  goMinS: .2,  pre: .12, ease: bez(.5, 0, .38, 1) },
  direct:   { label: "Direct",       goMin: 2.3,  goMinS: .28, pre: .02, ease: bez(.42, 0, .3, 1) },
  comet:    { label: "Comet",        goMin: 2.3,  goMinS: .24, pre: 0,   ease: bez(.32, .08, .38, 1) },
};
const VAR = () => VARIANTS[cfg.variant];
const MODES = {
  // full: O pops → K buds off the O → Flow springs in → melt into a ball
  full:  { introEnd: 2.5, pre: .44, fly: 1.02, pour: .56, tk: 1 },
  // returning visitor: ball springs in, then straight to the arrow
  short: { introEnd: .36, pre: .34, fly: .84, pour: .5, tk: 1.25 },
};
function timing(authAt) {
  const M = MODES[cfg.mode], V = VAR(), full = cfg.mode === "full", fly = cfg.variant === "direct" ? M.fly * .8 : M.fly;
  const go = max(full ? V.goMin : V.goMinS, authAt);
  const settle = full ? 2.5 : M.introEnd;                  // when the intro has fully become the resting ball
  const tFly = go + (cfg.variant === "original" ? M.pre : V.pre / M.tk), tLand = tFly + fly * .88, tEnd = tLand + M.pour;
  return { M, V, go, settle, tFly, tLand, tEnd, fly };
}
/* idle helpers. Each is continuous through `go`, so the hand-off to the arrow never jumps */
const idleEnv = (t, Tm) => smooth((t - Tm.M.introEnd) / .4);
function breathR(t, Tm) {
  const jt = t - 2.3, jig = cfg.mode === "full" && jt > 0 ? .06 * exp(-3.6 * jt) * sin(2 * PI * 2.7 * jt) : 0;
  const ti = t - Tm.M.introEnd; if (ti <= 0) return L.Rb * (1 + jig);
  const env = smooth(ti / .35) * (1 - smooth((t - Tm.go) / .22));
  return L.Rb * (1 + jig + env * (.03 * sin(2 * PI * ti / 2.6) + .012 * sin(2 * PI * ti / 1.1 + 1.3)));
}
function drift(t, Tm) {
  const ti = t - Tm.M.introEnd, e = idleEnv(t, Tm);
  return ti > 0 ? [e * 2.5 * sin(ti * .9), e * 3 * sin(ti * .7 + 1)] : [0, 0];
}
function ripple(t, Tm) {
  let amp = 0, ph = 0;
  const tm = t - 2.3;                                      // the gulp as the last letter lands
  if (cfg.mode === "full" && tm > 0) { amp = L.Rb * .035 * exp(-tm * 3) * smooth(tm / .06); ph = tm * 9; }
  const ti = t - Tm.M.introEnd, rt = (ti - 1.1) % 3.4;     // the odd surface ripple while idling
  if (ti > 1.1) { const a = L.Rb * .04 * exp(-rt * 1.6) * smooth(rt / .1) * idleEnv(t, Tm); if (a > amp) { amp = a; ph = rt * 7; } }
  return [amp, ph];
}
/* arrow pose during flight (also sampled in the past to spawn trail droplets) */
function flight(t, Tm) {
  const M = Tm.M, x = (t - Tm.tFly) / Tm.fly;
  const pull = cfg.variant === "original" ? -.028 * sin(PI * smoother(clamp(x / .2))) * (x < .2 ? 1 : 0) : 0;   // tiny wind-up (original only)
  const u = x <= 0 ? 0 : Tm.V.ease(x) + pull;
  const p = pathAt(u), a = pathAt(u - .004), b = pathAt(u + .004);
  const ang = (x <= 0 || hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) ? 0 : atan2(b[1] - a[1], b[0] - a[0]);
  const R0 = breathR(Tm.go, Tm), Rc = cfg.variant === "direct" ? R0 * .8 : min(R0, L.loopR * .5);           // never bigger than the loop it flies
  const R = lerp(lerp(R0, Rc, smooth(u / .12)), L.Rs, smoother((u - .12) / .78));
  return { p, ang, u, R, x };
}

function frame(t, authAt) {
  const Tm = timing(authAt), M = Tm.M, S0 = L.S0, C = L.C;
  const pieces = PIECES.map(() => ({ on: false }));
  const st = { pieces, kL: 0, arrow: null, trail: [], kT: 0, wob: 0, rip: 0, ripPh: 0, bc: C, shell: 0, done: false };
  const setP = (id, o) => Object.assign(pieces[PI_[id]], { on: true, s: 1, st: 1, dir: 0, m: 0, rc: 0, mode: 1, op: 1, rh: 25 }, o);

  /* ── intro + idle (until the arrow takes over) ── */
  if (t < Tm.go) {
    intro(t, Tm, st, setP, null, 0);
    // idle: breathe, drift, wobble and the odd ripple while auth is pending
    if (t > M.introEnd) {
      const P = pieces[PI_.O], dr = drift(t, Tm);
      P.x = C[0] + dr[0]; P.y = C[1] + dr[1];
      st.wob = L.Rb * .03 * idleEnv(t, Tm); st.bc = [P.x, P.y];
    }
    [st.rip, st.ripPh] = ripple(t, Tm);
    return st;
  }
  /* ── stretch → arrow → half-loop flight ── */
  if (t < Tm.tLand) { arrowPhase(t, Tm, st, setP); return st; }
  /* ── landing ── */
  if (t < Tm.tEnd) { landing(t, Tm, st, setP); return st; }
  st.shell = 1; st.done = true;
  return st;
}

/* hero framing: O alone is centred, then OK, then the full lockup */
function framing(t) {
  const S0 = L.S0, C = L.C;
  const cx = lerp(50, LOGO_W / 2, spr(t - .5, 1.25, .86));
  const cy = lerp(45, 70.5, spr(t - 1.02, 1.25, .86));
  const sc = 1 + .035 * smooth((t - 1.78) / .16);
  const opt = smoother((t - 1.02) / .48) * (1 - smoother((t - 1.78) / .32));   // optical centring: the O carries most of the ink
  const Sx = S0 * sc, org = [C[0] - (cx - 4 * opt) * Sx, C[1] - (cy - 3 * opt) * Sx];
  const A = id => { const a = PIECES[PI_[id]].anc; return [org[0] + a[0] * Sx, org[1] + a[1] * Sx]; };
  return { Sx, org, A };
}
const oPosAt = t => cfg.mode === "full"
  ? lerp2(lerp2(framing(t).A("O"), L.C, spr(t - 1.94, 1.45, .78)), L.C, smoother((t - 2.32) / .18))
  : L.C;

/* the intro (logo build + melt). `tgt`/`x`: when the arrow takes over early, the melt keeps
   running but pours into the moving arrow (tgt) while the O's own mass hands over (x: 0 → 1). */
function intro(t, Tm, st, setP, tgt, x) {
  const C = L.C, S0 = L.S0, pieces = st.pieces;
  {
    if (cfg.mode === "full") {
      const { Sx, org, A } = framing(t);
      const melt = t > 1.78;

      // O: springs in from nothing, later swallows everything and rounds into the ball
      const oPop = spr(t - .02, 2.1, .5);
      const fill = smoother((t - 1.94) / .42);
      const oPos0 = oPosAt(t), oPos = tgt ? lerp2(oPos0, tgt, x) : oPos0, hand = 1 - x;
      if (t > 0 && hand > .002) setP("O", t > 2.37
        ? { x: oPos[0], y: oPos[1], s: Sx, mode: 3, rc: breathR(t, Tm) * hand }
        : { x: oPos[0], y: oPos[1], s: Sx * max(oPop * hand, .001), mode: 4, m: fill, rh: 25 * (1 - smoother(fill / .55)), rc: breathR(t, Tm) * max(oPop, 0) * hand });

      // K: buds out of the O's right side as a droplet, stretches a goo neck, snaps free
      const kb = t - .5;
      if (kb > 0) {
        const pr = spr(kb, 1.75, .64), g = spr(kb - .14, 2.4, .6);
        const pos = lerp2([org[0] + 74 * Sx, org[1] + 50 * Sx], A("K"), pr);
        setP("K", { x: pos[0], y: pos[1], s: Sx * max(g, .001), mode: 1, m: 1 - smoother((kb - .14) / .22), rc: 12.5 * Sx * clamp(spr(kb, 2.6, .7) * 1.1) });
        st.kL = 15 * Sx * smooth(kb / .06) * (1 - smooth((kb - .2) / .38));
      }
      // Flow: B's spring pop, letter by letter
      ["F", "l", "o", "w"].forEach((id, i) => {
        const tq = t - 1.02 - i * .05, q = spr(tq, 2.4, .5);
        if (tq > 0) { const a = A(id); setP(id, { x: a[0], y: a[1] + 14 * Sx * (1 - q), s: Sx * (.6 + .4 * q), op: smooth(tq / .05) }); }
      });

      // melt: letters lean out (anticipation), then get pulled in on goo necks
      if (melt) {
        st.kL = max(st.kL, 22 * Sx * smooth((t - 2.0) / .16));   // goo only once letters are droplets
        const MASS = { K: 13, F: 9, l: 6.5, o: 9.5, w: 10 };
        ["K", "w", "o", "l", "F"].forEach((id, j) => {
          const P = pieces[PI_[id]]; if (!P.on) return;
          const p = clamp((t - 1.93 - j * .03) / .4), pe = Math.pow(p, 2.1);
          const base = [P.x, P.y], dir = atan2(C[1] - base[1], C[0] - base[0]);
          const lean = 2.4 * Sx * smooth((t - 1.78) / .15) * (1 - pe);
          const b2 = [base[0] - cos(dir) * lean, base[1] - sin(dir) * lean];
          const pos = lerp2(b2, tgt ? lerp2(oPos0, tgt, smoother(x * 1.4)) : oPos, pe);
          if (p >= 1) { P.on = false; return; }
          Object.assign(P, { x: pos[0], y: pos[1], st: 1 + .3 * sin(PI * p), dir, op: 1,
            mode: 1, m: smoother(p / .38), rc: MASS[id] * Sx * (1 - smoother((p - .55) / .45)) });
        });
        st.bc = oPos;
      }
    } else {
      // returning visitor: the ball just springs into existence
      const q = lerp(spr(t, 2.3, .55), 1, smoother((t - .24) / .12)), pos = tgt ? lerp2(C, tgt, x) : C;
      if (1 - x > .002) setP("O", { x: pos[0], y: pos[1], s: S0, mode: 3, rc: breathR(t, Tm) * max(q, .001) * (1 - x) });
    }
  }
}

/* ball → arrow → flight. Each variant shapes the morph differently. */
function arrowPhase(t, Tm, st, setP) {
  const M = Tm.M, V = cfg.variant;
  {
    const ta = (t - Tm.go) * M.tk;
    const fl = flight(t, Tm);
    const lam = smooth((t - (Tm.tLand - .26 / M.tk)) / (.25 / M.tk));     // fold back into a ball
    let sig, e, aq = 0;
    if (V === "original") {                                                // three beats: squash, pill, wings
      sig = clamp(spr(ta - .1, 2.0, .45), 0, 1.15);
      e = clamp(spr(ta - .28, 1.8, .52), 0, 1.1);
      aq = smooth(ta / .12) * (1 - smooth((ta - .1) / .12));
    } else if (V === "flow") {                                             // one curve: shaft and wings grow together
      const S = spr(ta, 1.65, .74); sig = clamp(S * 1.08, 0, 1.12); e = clamp(spr(ta - .05, 1.65, .74), 0, 1.08);
    } else if (V === "direct") {                                           // no arrow: the blob itself flies (shaped by speed below)
      sig = 0; e = 0;
    } else {                                                               // comet: a stretched droplet launches, the head forms in flight
      sig = clamp(spr(ta, 1.5, .8), 0, 1.1); e = smoother((ta - .16) / .5) * 1.0;
    }
    sig *= 1 - lam; e *= 1 - lam;
    let sx = 1 - .14 * aq, sy = 1 + .12 * aq;
    // speed stretch + tail bend from the turn rate
    const h = 1 / 240, f0 = flight(t - h, Tm), f1 = flight(t + h, Tm);
    const v = hypot(f1.p[0] - f0.p[0], f1.p[1] - f0.p[1]) / (2 * h);
    let dth = f1.ang - f0.ang; dth = atan2(sin(dth), cos(dth));
    const vn = v / (curPath().len / Tm.fly * 1.7);
    if (fl.x > 0) { const k = 1 + .34 * clamp(vn, 0, 1.3) * (1 - lam); sx *= k; sy /= sqrt(k); }
    if (V === "direct") sig = .5 * clamp(vn, 0, 1) * (1 - lam);         // fast blob draws out into a droplet
    const bend = clamp(dth / (2 * h) * .016, -.3, .3) * (1 - lam);
    const out = 1 - smooth(ta / .3), dr = drift(Tm.go, Tm), rp = ripple(Tm.go, Tm);
    st.wob = L.Rb * .03 * idleEnv(Tm.go, Tm) * out;
    st.rip = rp[0] * (1 - smooth(ta / .15)); st.ripPh = rp[1] + ta * 7; st.bc = fl.p;
    // early take-over: start where the O actually is, and pour the still-melting logo into the arrow
    let R = fl.R, c = [fl.p[0] + dr[0] * out, fl.p[1] + dr[1] * out];
    if (Tm.go < Tm.settle && t < Tm.settle + .5) {
      const o0 = oPosAt(Tm.go), back = 1 - smoother(ta / .38);
      c = [c[0] + (o0[0] - L.C[0]) * back, c[1] + (o0[1] - L.C[1]) * back];
      const x = smoother(ta / .26);
      R *= lerp(V === "direct" ? .8 : .55, 1, x);
      intro(t, Tm, st, setP, c, x);
      st.kL *= 1 - smooth((ta - .22) / .2);
    }
    st.arrow = arrowCaps(c, R, fl.ang, sig, e, sx, sy, bend);
    st.kT = R * .32;
    // trail: droplets pinch off the tail, coast, and shrink away
    if (fl.x > 0) for (let i = 0; i < 8; i++) {
      const ti = Tm.tFly + Tm.fly * (.14 + i * .065);
      if (ti > Tm.tLand - .18 || t < ti) continue;
      const age = (t - ti) * M.tk, fp = flight(ti, Tm), dir = [cos(fp.ang), sin(fp.ang)];
      const fa = flight(ti - h, Tm), fb = flight(ti + h, Tm), vi = hypot(fb.p[0] - fa.p[0], fb.p[1] - fa.p[1]) / (2 * h);
      const tail = [fp.p[0] - dir[0] * 1.5 * fp.R, fp.p[1] - dir[1] * 1.5 * fp.R];
      const coast = vi * .12 * (1 - exp(-age * 7)), side = (hash(i) - .5) * fp.R * .5 * smooth(age / .3);
      const pos = [tail[0] + dir[0] * coast - dir[1] * side, tail[1] + dir[1] * coast + dir[0] * side];
      const r = fp.R * (.09 + .07 * hash(i + 9)) * smooth(age / .05) * (1 - smooth((age - .04) / .34));
      if (r > .05) st.trail.push([pos[0], pos[1], r]);
    }
    st.shell = smooth((t - (Tm.tFly + Tm.fly * .42)) / (Tm.fly * .4));
  }
}

/* landing: the ball pours back out into the small logo */
function landing(t, Tm, st, setP) {
  const M = Tm.M;
  {
    const tr = (t - Tm.tLand) * M.tk, S1 = L.S1, T0 = L.T0;
    const lock = smoother((t - (Tm.tEnd - .16)) / .08), set = v => lerp(v, 1, lock);
    // settle the last few px: cubic Hermite from the incoming position + velocity to rest on the target
    const H = .14, u = clamp(tr / H), p0 = flight(Tm.tLand, Tm).p, ha = flight(Tm.tLand - 1 / 240, Tm).p, hb = flight(Tm.tLand + 1 / 240, Tm).p;
    const v0 = [(hb[0] - ha[0]) * 120 / M.tk, (hb[1] - ha[1]) * 120 / M.tk];
    const h00 = 2*u*u*u - 3*u*u + 1, h10 = u*u*u - 2*u*u + u, h01 = 3*u*u - 2*u*u*u;
    const TO = [h00 * p0[0] + h10 * H * v0[0] + h01 * L.TO[0], h00 * p0[1] + h10 * H * v0[1] + h01 * L.TO[1]];
    setP("O", { x: TO[0], y: TO[1], s: S1 * lerp(.78, 1, set(spr(tr, 2.4, .6))), mode: 4, m: 1 - smooth(tr / .26), rh: 25 * smoother((tr - .06) / .2), rc: L.Rs });
    const del = { K: 0, F: .04, l: .055, o: .07, w: .09 };
    for (const id of ["K", "F", "l", "o", "w"]) {
      const q = set(spr(tr - del[id], 2.5, .62)); if (q <= 0) continue;
      const a = PIECES[PI_[id]].anc, fin = [T0[0] + a[0] * S1, T0[1] + a[1] * S1];
      const dl = hypot(fin[0] - TO[0], fin[1] - TO[1]), rim = [TO[0] + (fin[0] - TO[0]) / dl * 36 * S1, TO[1] + (fin[1] - TO[1]) / dl * 36 * S1];
      const pos = lerp2(rim, fin, q);   // letters bud out of the ring, like the K in the intro
      setP(id, { x: pos[0], y: pos[1], s: S1 * max(lerp(-.1, 1, q), .001), st: lerp(1 + .25 * sin(PI * clamp(q)), 1, lock), dir: atan2(fin[1] - TO[1], fin[0] - TO[0]),
        mode: 2, rc: 7 * S1 * smooth(q / .15) * (1 - smoother((q - .2) / .5)) });
    }
    st.kL = 11 * S1 * (1 - smooth(tr / .42));
    st.shell = 1;
  }
}

/* arrow in its own frame (x = forward); ball → pill → arrow, area-conserving */
function arrowCaps(c, R, ang, sig, e, sx, sy, bend) {
  R *= 1 + .24 * clamp(e);
  const r0 = 1 - .5 * sig, l0 = PI * (1 - r0 * r0) / (4 * r0), ec = min(e, 1.1), ox = -.14 * ec;
  const P = (x, y) => [(x + ox) * R, y * R];
  const ax = lerp(-l0, -1.6, ec), bx = lerp(l0, 1.15, ec), ra = lerp(r0, .2, ec), rb = lerp(r0, .3, ec), rm = (ra + rb) / 2;
  const pt = k => P(lerp(ax, bx, k), bend * 4 * k * (1 - k) * 1.6), B = P(bx, 0), r = k => lerp(ra, rb, k) * R;
  const caps = [[...pt(0), ...pt(1/3), r(0), r(1/3)], [...pt(1/3), ...pt(2/3), r(1/3), r(2/3)], [...pt(2/3), ...B, r(2/3), r(1)]];
  const wr = .29 * clamp(e, 0, 1.1) * R;
  if (wr > .3) { const W1 = P(bx - .98 * ec, 1.05 * ec), W2 = P(bx - .98 * ec, -1.05 * ec); caps.push([...B, ...W1, wr, wr], [...B, ...W2, wr, wr]); }
  else caps.push([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]);
  return { c, ang, sx, sy, caps, kA: R * .2, R };
}

/* ════════════════════════════════════════════════════════════════════
   7. DRAW
   ════════════════════════════════════════════════════════════════════ */
const buf = { PA: new Float32Array(24), PM: new Float32Array(24), PC: new Float32Array(24), cap: new Float32Array(20), capR: new Float32Array(10), tr: new Float32Array(42) };
let brandRGB = [1, .384, .141];
function readBrand() {
  const h = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim().replace("#", "");
  brandRGB = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function draw(st, time) {
  buf.PA.fill(0); buf.PM.fill(0); buf.PC.fill(0); buf.tr.fill(0);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const grow = (x, y, r) => { x0 = min(x0, x - r); y0 = min(y0, y - r); x1 = max(x1, x + r); y1 = max(y1, y + r); };
  st.pieces.forEach((P, i) => {
    if (!P.on || P.s <= 1e-4) return;
    const a = 1 / P.st, b = sqrt(P.st), c = cos(P.dir), s = sin(P.dir), k = 1 / P.s;
    const m00 = (c * c * a + s * s * b) * k, m01 = c * s * (a - b) * k, m11 = (s * s * a + c * c * b) * k;
    buf.PA.set([P.x, P.y, P.s * min(P.st, 1 / b), P.m], i * 4);
    buf.PM.set([m00, m01, m01, m11], i * 4);
    buf.PC.set([P.rc, P.mode, P.op, P.rh], i * 4);
    grow(P.x, P.y, max(P.mode === 3 ? 0 : ATLAS.cells[i].rad * P.s * max(P.st, 1), P.rc));
  });
  const A = st.arrow;
  if (A) {
    A.caps.forEach((q, i) => { buf.cap.set(q.slice(0, 4), i * 4); buf.capR.set(q.slice(4, 6), i * 2); });
    grow(A.c[0], A.c[1], A.R * 2.2 * max(A.sx, A.sy));
  }
  st.trail.slice(0, 14).forEach((d, i) => { buf.tr.set(d, i * 3); grow(d[0], d[1], d[2]); });
  const pad = st.kL + st.kT + st.wob * 2 + st.rip * 2 + 6;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.scissor(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
  if (x1 < x0) return;
  const d = L.dpr, sx0 = Math.floor((x0 - pad) * d), sy0 = Math.floor((L.vh - (y1 + pad)) * d);
  gl.scissor(max(0, sx0), max(0, sy0), Math.ceil((x1 - x0 + 2 * pad) * d), Math.ceil((y1 - y0 + 2 * pad) * d));
  gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform1f(U.uDpr, d); gl.uniform1f(U.uTime, time);
  gl.uniform4fv(U.uPA, buf.PA); gl.uniform4fv(U.uPM, buf.PM); gl.uniform4fv(U.uPC, buf.PC);
  gl.uniform1f(U.uKL, st.kL);
  gl.uniform1f(U.uArrowOn, A ? 1 : 0);
  if (A) { gl.uniform4f(U.uAX, A.c[0], A.c[1], A.ang, 0); gl.uniform2f(U.uAS, A.sx, A.sy); gl.uniform4fv(U.uCap, buf.cap); gl.uniform2fv(U.uCapR, buf.capR); gl.uniform1f(U.uKA, A.kA); }
  gl.uniform3fv(U.uTr, buf.tr); gl.uniform1f(U.uKT, st.kT);
  gl.uniform4f(U.uW, st.wob, 1 / (L.Rb * .9), st.rip, st.ripPh);
  gl.uniform2f(U.uBC, st.bc[0], st.bc[1]);
  gl.uniform3f(U.uCol, ...brandRGB);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}


let cancelled = false;
let raf = 0;
const finish = () => {
  if (cancelled) return;
  cancelled = true;
  cancelAnimationFrame(raf);
  removeEventListener('resize', layout);
  brandLogo.style.opacity = '';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  onComplete();
};
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onComplete(); return () => {}; }
if (!initGL()) { onComplete(); return () => {}; }
layout(); readBrand();
brandLogo.style.opacity = '0';
addEventListener('resize', layout);
const start = performance.now();
function tick(now) {
  if (cancelled) return;
  const time = (now - start) / 1000;
  const state = frame(time, 0);
  backdrop.style.opacity = String(1 - state.shell);
  if (state.done) { finish(); return; }
  draw(state, time);
  raf = requestAnimationFrame(tick);
}
raf = requestAnimationFrame(tick);
return finish;
}
