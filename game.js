/* YASUO: THE FORGOTTEN REALM — playable prototype
   Three.js open-world action RPG. Expandable boss registry + region system.
   Three.js loads from local vendor/ first (offline-safe), CDN as fallback. */
let THREE;
try {
  THREE = await import('./vendor/three.module.js');
} catch (localErr) {
  try {
    THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
  } catch (cdnErr) {
    const el = document.getElementById('load-error');
    if (el) {
      el.classList.remove('hidden');
      el.textContent = 'Could not load the 3D engine (local vendor + CDN both failed). ' +
        'Serve this folder over http (e.g. ./start.sh) and allow internet access, then reload.';
    }
    throw cdnErr;
  }
}

const $ = (id) => document.getElementById(id);
window.addEventListener('error', (e) => {
  const el = $('load-error');
  if (el && !$('title-screen').classList.contains('hidden')) {
    el.classList.remove('hidden');
    el.textContent = 'Error: ' + (e.message || 'failed to load') + ' — check connection (Three.js CDN required).';
  }
});

/* ============ SAVE ============ */
const SAVE_KEY = 'yasuo_forgotten_realm_v1';
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } }
function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {} }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

/* ============ AUDIO (procedural, no assets) ============ */
const AudioSys = {
  ctx: null, muted: false, musicTimer: 0, intensity: 0,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  },
  tone(freq, dur, type = 'sine', vol = 0.15, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur = 0.2, vol = 0.12, low = 400) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t);
  },
  swing() { this.noise(0.15, 0.10, 2500); },
  hit() { this.tone(140, 0.18, 'square', 0.12, -60); this.noise(0.12, 0.14, 900); },
  heavyHit() { this.tone(90, 0.3, 'sawtooth', 0.16, -40); this.noise(0.25, 0.16, 600); },
  tornado() { this.noise(0.7, 0.14, 1200); this.tone(220, 0.6, 'sine', 0.08, 220); },
  wall() { this.tone(330, 0.4, 'triangle', 0.1, 110); },
  dash() { this.noise(0.2, 0.1, 3000); },
  drink() { this.tone(300, 0.15, 'sine', 0.1, 150); setTimeout(() => this.tone(420, 0.2, 'sine', 0.1, 120), 140); },
  levelup() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.12), i * 110)); },
  shrine() { [523, 392, 659].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'sine', 0.09), i * 160)); },
  death() { this.tone(220, 1.2, 'sawtooth', 0.14, -180); },
  bossRoar() { this.tone(70, 1.0, 'sawtooth', 0.2, 40); this.noise(0.8, 0.15, 500); },
  // generative dark-fantasy pulse: slow taiko + wind drone, intensity 0..1
  music(dt) {
    if (!this.ctx || this.muted) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const base = this.intensity > 0.5 ? 0.28 : 0.6; // faster in boss
    this.musicTimer = base + Math.random() * base;
    const drums = [55, 65, 49, 58];
    this.tone(drums[Math.floor(Math.random() * drums.length)], 0.35, 'sine', 0.16, -8);
    if (Math.random() < 0.35 + this.intensity * 0.4) {
      const scale = [110, 130.8, 146.8, 164.8, 196];
      this.tone(scale[Math.floor(Math.random() * scale.length)], 1.4, 'triangle', 0.045);
    }
    if (Math.random() < 0.25) this.noise(1.2, 0.03, 600); // wind
  }
};

/* ============ INPUT ============ */
const Input = {
  keys: {}, mouseDown: false, rDown: false, mouseDX: 0, mouseDY: 0,
  dragging: false, lastX: 0, lastY: 0, locked: false, sens: 1,
  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space'].includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys[e.code] = true;
      if (e.code === 'Tab') Game.toggleLockOn();
      if (e.code === 'KeyM') { AudioSys.muted = !AudioSys.muted; Game.toast(AudioSys.muted ? '🔇 Sound muted' : '🔊 Sound on'); }
      if (e.code === 'BracketLeft') { Input.sens = Math.max(0.4, +(Input.sens - 0.2).toFixed(1)); Game.toast('🎥 Camera sensitivity ' + Input.sens.toFixed(1)); }
      if (e.code === 'BracketRight') { Input.sens = Math.min(2.2, +(Input.sens + 0.2).toFixed(1)); Game.toast('🎥 Camera sensitivity ' + Input.sens.toFixed(1)); }
      if (e.code === 'KeyP' || e.code === 'Escape') Game.togglePause();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    canvas.addEventListener('mousedown', (e) => {
      AudioSys.init();
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rDown = true;
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      if (Game.state === 'playing' && !this.locked && e.button === 0 && Game.mouseLook) {
        canvas.requestPointerLock?.();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rDown = false;
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.mouseDX += e.movementX; this.mouseDY += e.movementY;
      } else if (this.dragging) {
        this.mouseDX += e.clientX - this.lastX; this.mouseDY += e.clientY - this.lastY;
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      Game.camDist = Math.max(4, Math.min(11, Game.camDist + e.deltaY * 0.005));
    }, { passive: false });
  },
  pressed(code) { return !!this.keys[code]; }
};

/* ============ RENDERER / SCENE ============ */
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1) * 0.62); // PS2 pixelation
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b1e3e);
scene.fog = new THREE.FogExp2(0x7a5a70, 0.008); // warm sunset haze

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

const hemi = new THREE.HemisphereLight(0x9a8fd0, 0x4a2c1a, 1.35);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xffb36b, 1.7); // low sunset sun
moon.position.set(90, 42, -30);
moon.castShadow = true;
moon.shadow.bias = -0.0004;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -60; moon.shadow.camera.right = 60;
moon.shadow.camera.top = 60; moon.shadow.camera.bottom = -60;
moon.shadow.camera.far = 300;
scene.add(moon);
const warm = new THREE.PointLight(0xff9a4a, 0.7, 60); // shrine-side warmth follows player lightly
scene.add(warm);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

/* ============ WORLD: height + regions ============ */
const WORLD_R = 190;
function groundH(x, z) {
  const d = Math.hypot(x, z);
  let h = Math.sin(x * 0.045) * Math.cos(z * 0.05) * 2.2
        + Math.sin(x * 0.013 + 2.0) * 3.0
        + Math.cos(z * 0.017 - 1.0) * 2.4;
  // flatten spawn glade + boss arena
  const flat = (cx, cz, r) => {
    const dd = Math.hypot(x - cx, z - cz);
    if (dd < r) { const t = dd / r; return t * t * (3 - 2 * t); }
    return 1;
  };
  const k = Math.min(flat(0, 20, 26), flat(0, -120, 46));
  h *= (1 - k) * 1 + k * 0.12;
  if (d > WORLD_R) h -= (d - WORLD_R) * 0.35; // rim falls away
  return h;
}

const colliders = []; // {x,z,r}
const shrines = [
  { x: 0, z: 20, name: 'Wanderer\'s Shrine', lit: true },
  { x: -70, z: -40, name: 'Sunken Village Shrine', lit: false },
  { x: 60, z: -70, name: 'Temple Gate Shrine', lit: false },
];
const ARENA = { x: 0, z: -120, r: 30 };

/* Expandable boss registry — future champions plug in here */
const BOSS_REGISTRY = {
  yone:  { name: 'YONE — THE UNFORGOTTEN', arena: ARENA, implemented: true, reward: 'MOONFALL BLADE' },
  zed:   { name: 'ZED — THE MASTER OF SHADOWS', implemented: false },
  riven: { name: 'RIVEN — THE EXILE', implemented: false },
  darius:{ name: 'DARIUS — THE HAND OF NOXUS', implemented: false },
  jhin:  { name: 'JHIN — THE VIRTUOSO', implemented: false },
  katarina:{ name: 'KATARINA — THE SINISTER BLADE', implemented: false },
  aatrox:{ name: 'AATROX — THE DARKIN BLADE', implemented: false },
  mordekaiser:{ name: 'MORDEKAISER — THE IRON REVENANT', implemented: false },
};

/* ============ MATERIALS / HELPERS ============ */
const MAT = {
  stone: new THREE.MeshLambertMaterial({ color: 0x6f6f7e, flatShading: true }),
  darkStone: new THREE.MeshLambertMaterial({ color: 0x3d3d4d, flatShading: true }),
  mossStone: new THREE.MeshLambertMaterial({ color: 0x55604a, flatShading: true }),
  wood: new THREE.MeshLambertMaterial({ color: 0x5a3d26, flatShading: true }),
  darkWood: new THREE.MeshLambertMaterial({ color: 0x33241a, flatShading: true }),
  roof: new THREE.MeshLambertMaterial({ color: 0x24344d, flatShading: true }),
  blossom: new THREE.MeshLambertMaterial({ color: 0xe09ac0, emissive: 0x4a1a33 }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x2e6b35 }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x4a3423, flatShading: true }),
  lantern: new THREE.MeshBasicMaterial({ color: 0xffb95e }),
  spirit: new THREE.MeshBasicMaterial({ color: 0x9fe8ff }),
  gold: new THREE.MeshBasicMaterial({ color: 0xffd257 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  wind: new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  wall: new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
};
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
/* Voxel chibi fighter (reference look): chunky cubes, big head, topknot,
   Ionian wrap + katana. Returns the same posable rig {group, parts}. */
const UNIT = new THREE.BoxGeometry(1, 1, 1);
function vox(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(UNIT, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function makeFighter({ skin = 0xd9a066, cloth = 0x2e3f9e, trim = 0xc9a227, hair = 0x2b2440, sword = 0xd7e3f5, pupil = 0x14141c, pants = null } = {}) {
  const g = new THREE.Group();
  const pantsC = pants ?? new THREE.Color(cloth).multiplyScalar(0.5).getHex();
  const skinM = new THREE.MeshLambertMaterial({ color: skin });
  const topM = new THREE.MeshLambertMaterial({ color: cloth });
  const pantsM = new THREE.MeshLambertMaterial({ color: pantsC });
  const trimM = new THREE.MeshLambertMaterial({ color: trim, emissive: 0x2a2000 });
  const hairM = new THREE.MeshLambertMaterial({ color: hair });
  const swordM = new THREE.MeshLambertMaterial({ color: sword, emissive: 0x3a4a66 });
  const darkM = new THREE.MeshLambertMaterial({ color: 0x1d1a26 });
  const ropeM = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const tieM = new THREE.MeshLambertMaterial({ color: 0x8a2a2a });
  const whiteM = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  const pupilM = new THREE.MeshBasicMaterial({ color: pupil });
  // legs (wide hakama): pivots at hips
  const mkLeg = (x) => {
    const p = new THREE.Group(); p.position.set(x, 0.95, 0); g.add(p);
    vox(0.36, 0.6, 0.4, pantsM, 0, -0.3, 0, p);
    vox(0.3, 0.14, 0.46, darkM, 0, -0.66, 0.03, p);
    return p;
  };
  const legL = mkLeg(-0.2), legR = mkLeg(0.2);
  // torso: bare chest + shoulder wrap + rope belt + sash
  const torso = vox(0.7, 0.66, 0.44, skinM, 0, 1.32, 0, g);
  vox(0.8, 0.26, 0.5, topM, 0, 1.58, 0, g);
  vox(0.76, 0.16, 0.48, ropeM, 0, 0.98, 0, g);
  vox(0.2, 0.3, 0.06, topM, -0.3, 0.82, 0.2, g).rotation.z = 0.25;
  // arms: sleeve + forearm + fist
  const mkArm = (x) => {
    const p = new THREE.Group(); p.position.set(x, 1.6, 0); g.add(p);
    vox(0.26, 0.3, 0.3, topM, 0, -0.13, 0, p);
    vox(0.22, 0.4, 0.24, skinM, 0, -0.46, 0, p);
    vox(0.22, 0.18, 0.22, skinM, 0, -0.74, 0, p);
    return p;
  };
  const armL = mkArm(-0.54), armR = mkArm(0.54);
  // katana in right fist
  const swordPivot = new THREE.Group(); swordPivot.position.set(0, -0.8, 0.06); armR.add(swordPivot);
  vox(0.09, 0.36, 0.09, darkM, 0, -0.1, 0, swordPivot);
  vox(0.26, 0.07, 0.14, trimM, 0, -0.3, 0, swordPivot);
  vox(0.12, 1.4, 0.05, swordM, 0, -1.05, 0.06, swordPivot).rotation.x = 0.12;
  // scabbard on back
  vox(0.12, 1.0, 0.12, darkM, 0.28, 1.45, -0.3, g).rotation.z = 0.5;
  // big chibi head
  const head = new THREE.Group(); head.position.set(0, 1.98, 0); g.add(head);
  vox(0.6, 0.55, 0.55, skinM, 0, 0, 0, head);
  vox(0.66, 0.26, 0.6, hairM, 0, 0.3, -0.03, head);
  vox(0.66, 0.5, 0.16, hairM, 0, 0.02, -0.3, head);
  vox(0.14, 0.4, 0.14, hairM, -0.3, -0.05, 0.14, head);
  vox(0.14, 0.4, 0.14, hairM, 0.3, -0.05, 0.14, head);
  vox(0.17, 0.06, 0.04, hairM, -0.15, 0.1, 0.28, head).rotation.z = -0.25;
  vox(0.17, 0.06, 0.04, hairM, 0.15, 0.1, 0.28, head).rotation.z = 0.25;
  vox(0.42, 0.12, 0.03, whiteM, 0, -0.02, 0.28, head);
  vox(0.07, 0.09, 0.02, pupilM, -0.11, -0.02, 0.3, head);
  vox(0.07, 0.09, 0.02, pupilM, 0.11, -0.02, 0.3, head);
  vox(0.62, 0.2, 0.57, topM, 0, -0.26, 0.01, head);
  vox(0.24, 0.24, 0.24, hairM, 0, 0.52, -0.05, head);
  vox(0.28, 0.09, 0.28, tieM, 0, 0.38, -0.05, head);
  // flowing ponytail
  const ponytail = new THREE.Group(); ponytail.position.set(0, 0.42, -0.34); head.add(ponytail);
  vox(0.2, 0.18, 0.5, hairM, 0, 0.02, -0.22, ponytail);
  vox(0.15, 0.14, 0.45, hairM, 0, -0.2, -0.6, ponytail);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, armL, armR, legL, legR, torso, head, swordPivot, ponytail };
}

/* Hand-painted stripe texture (LoL-style fabric patterns) */
function stripeTex(base, line, chevron = true) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = line; x.lineWidth = 4; x.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const p = (i + 0.5) * 64 / 5;
    x.beginPath();
    if (chevron) { x.moveTo(2, p); x.lineTo(32, p - 9); x.lineTo(62, p); }
    else { x.moveTo(p, 0); x.lineTo(p - 6, 64); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* HERO builder — LoL-proportioned stylised fighter.
   Lean athletic build, strand hair + headband + ponytail, layered wrap,
   rope belt + gourd, arm guards, pauldron, hakama, curved katana + sheath.
   Same rig interface as makeFighter plus cape/sheath/bandTails/swordPivotL. */
function makeHero({ skin = 0xc98a5e, wrap = '#2e6fd8', hak = '#2b2b57', hair = 0x1e3a3a, trim = 0xc9a227, steel = 0xd7e3f5, pupil = 0x14141c, dual = false, spirit = false, simple = false } = {}) {
  const g = new THREE.Group();
  const skinM = new THREE.MeshLambertMaterial({ color: skin });
  const wrapM = new THREE.MeshLambertMaterial({ map: stripeTex(wrap, '#8fb8ff') });
  const hakM = new THREE.MeshLambertMaterial({ map: stripeTex(hak, '#5a6fc8', false) });
  const hairM = new THREE.MeshLambertMaterial({ color: hair });
  const darkM = new THREE.MeshLambertMaterial({ color: 0x241d18 });
  const leatherM = new THREE.MeshLambertMaterial({ color: 0x4a2e1a });
  const silverM = new THREE.MeshLambertMaterial({ color: 0xb9c4d4, emissive: 0x1a2233 });
  const goldM = new THREE.MeshLambertMaterial({ color: trim, emissive: 0x2a2000 });
  const steelM = new THREE.MeshLambertMaterial({ color: steel, emissive: 0x2a3a55 });
  const spiritM = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, emissive: 0x2a88bb });
  const whiteM = new THREE.MeshBasicMaterial({ color: 0xf5f2ea });
  const pupM = new THREE.MeshBasicMaterial({ color: pupil });
  const ropeM = new THREE.MeshLambertMaterial({ color: 0x9a7434 });
  const bandM = new THREE.MeshLambertMaterial({ color: 0x2e6fd8 });
  const cyl = (rt, rb, h, mat, x, y, z, parent, seg = 8) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  const sph = (r, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m;
  };
  // legs: trousers + wraps + sandals
  const mkLeg = (x) => {
    const p = new THREE.Group(); p.position.set(x, 0.95, 0); g.add(p);
    cyl(0.13, 0.11, 0.42, hakM, 0, -0.21, 0, p);
    cyl(0.085, 0.07, 0.36, darkM, 0, -0.6, 0, p);
    vox(0.13, 0.07, 0.3, darkM, 0, -0.83, 0.05, p);
    return p;
  };
  const legL = mkLeg(-0.16), legR = mkLeg(0.16);
  cyl(0.24, 0.37, 0.5, hakM, 0, 0.78, 0, g, 10); // hakama skirt
  // torso: bare chest + diagonal strap
  const torso = cyl(0.17, 0.14, 0.52, skinM, 0, 1.32, 0, g, 10);
  if (!simple) vox(0.09, 0.52, 0.05, leatherM, -0.04, 1.34, 0.15, g).rotation.z = 0.55;
  // rope belt + cord + gourd
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 14), ropeM);
  belt.rotation.x = Math.PI / 2; belt.position.set(0, 1.04, 0); belt.castShadow = true; g.add(belt);
  if (!simple) {
    cyl(0.025, 0.025, 0.5, ropeM, 0.22, 0.8, 0.05, g).rotation.z = 0.15;
    cyl(0.06, 0.05, 0.16, new THREE.MeshLambertMaterial({ color: 0x3a5a2e }), 0.27, 0.6, 0.08, g);
  }
  // shoulder cape (animated secondary motion)
  const cape = new THREE.Group(); cape.position.set(0, 1.62, -0.06); g.add(cape);
  const capeM = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.55, 8), wrapM);
  capeM.scale.set(1.25, 1, 0.62); capeM.position.set(0, -0.24, -0.06); capeM.castShadow = true; cape.add(capeM);
  // arms: skin + leather guard + metal plate + fist
  const mkArm = (x) => {
    const p = new THREE.Group(); p.position.set(x, 1.56, 0); g.add(p);
    cyl(0.07, 0.062, 0.3, skinM, 0, -0.15, 0, p);
    cyl(0.078, 0.07, 0.32, leatherM, 0, -0.44, 0, p);
    if (!simple) vox(0.05, 0.2, 0.1, silverM, x > 0 ? -0.07 : 0.07, -0.44, 0, p);
    sph(0.07, skinM, 0, -0.66, 0, p);
    return p;
  };
  const armL = mkArm(-0.44), armR = mkArm(0.44);
  if (!simple) {
    sph(0.11, silverM, -0.44, 1.68, 0, g, 1.2, 0.7, 1.1); // pauldron
    vox(0.16, 0.05, 0.2, silverM, -0.48, 1.6, 0, g);
  }
  // head + face
  const head = new THREE.Group(); head.position.set(0, 1.88, 0); g.add(head);
  sph(0.165, skinM, 0, 0, 0, head, 0.95, 1.05, 0.95);
  sph(0.032, whiteM, -0.062, 0.01, 0.145, head, 1, 1.3, 0.5);
  sph(0.032, whiteM, 0.062, 0.01, 0.145, head, 1, 1.3, 0.5);
  sph(0.014, pupM, -0.062, 0.01, 0.165, head);
  sph(0.014, pupM, 0.062, 0.01, 0.165, head);
  vox(0.07, 0.018, 0.02, hairM, -0.065, 0.075, 0.15, head).rotation.z = -0.2;
  vox(0.07, 0.018, 0.02, hairM, 0.065, 0.075, 0.15, head).rotation.z = 0.2;
  // spiky hair mass + topknot bun
  sph(0.175, hairM, 0, 0.05, -0.03, head, 1, 0.95, 1);
  if (!simple) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 5), hairM);
      sp.position.set(Math.cos(a) * 0.1, 0.2, Math.sin(a) * 0.1 - 0.02);
      sp.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
      sp.castShadow = true; head.add(sp);
    }
    sph(0.085, hairM, 0, 0.24, -0.1, head);
  }
  const bandTails = new THREE.Group(); bandTails.position.set(0, 0.05, -0.17); head.add(bandTails);
  if (!simple) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.028, 6, 14), bandM);
    band.rotation.x = Math.PI / 2 - 0.12; band.position.set(0, 0.06, 0.01); head.add(band);
    vox(0.05, 0.03, 0.4, bandM, -0.04, 0, -0.2, bandTails);
    vox(0.05, 0.03, 0.34, bandM, 0.05, -0.03, -0.17, bandTails);
  }
  // ponytail (animated)
  const ponytail = new THREE.Group(); ponytail.position.set(0, 0.12, -0.2); head.add(ponytail);
  if (simple) {
    const seg = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), hairM);
    seg.rotation.x = 2.2; seg.position.set(0, -0.08, -0.14); seg.castShadow = true; ponytail.add(seg);
  } else {
    const seg1 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), hairM);
    seg1.rotation.x = 2.2; seg1.position.set(0, -0.08, -0.14); seg1.castShadow = true; ponytail.add(seg1);
    const seg2 = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.28, 6), hairM);
    seg2.rotation.x = 2.5; seg2.position.set(0, -0.3, -0.3); seg2.castShadow = true; ponytail.add(seg2);
  }
  // curved katana builder
  const katana = (bladeMat) => {
    const k = new THREE.Group();
    cyl(0.028, 0.028, 0.3, darkM, 0, 0, 0, k);
    vox(0.05, 0.05, 0.05, goldM, 0, 0.1, 0, k);
    vox(0.05, 0.05, 0.05, goldM, 0, -0.1, 0, k);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 10), goldM);
    guard.position.set(0, -0.17, 0); k.add(guard);
    let y = -0.18, off = 0;
    for (let i = 0; i < 5; i++) {
      const bl = vox(0.035, 0.24, 0.012, bladeMat, off, y - 0.12, 0, k);
      bl.rotation.x = 0; bl.rotation.z = 0; bl.position.x = off;
      off += 0.022; y -= 0.235;
      bl.rotation.z = -0.09;
    }
    return k;
  };
  const swordPivot = new THREE.Group(); swordPivot.position.set(0, -0.68, 0.03); armR.add(swordPivot);
  swordPivot.add(katana(steelM));
  // sheath at left hip (visible when sword sheathed; skipped on simple rigs)
  let sheath = null;
  if (!simple) {
    sheath = new THREE.Group(); sheath.position.set(-0.26, 1.0, 0.06); sheath.rotation.z = 0.35; g.add(sheath);
    let sy = 0;
    for (let i = 0; i < 4; i++) {
      const s = vox(0.07, 0.28, 0.05, darkM, sy * 0.4, -sy, 0, sheath);
      s.rotation.z = -0.12; sy += 0.26;
    }
  }
  // second blade for dual wielders (Yone)
  let swordPivotL = null;
  if (dual) {
    swordPivotL = new THREE.Group(); swordPivotL.position.set(0, -0.68, 0.03); armL.add(swordPivotL);
    swordPivotL.add(katana(spirit ? spiritM : steelM));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, armL, armR, legL, legR, torso, head, swordPivot, ponytail, cape, sheath, bandTails, swordPivotL, dual };
}

/* ============ WORLD BUILD ============ */
const worldGroup = new THREE.Group(); scene.add(worldGroup);
const pickups = [];   // {mesh,type,amount,taken,x,z}
const npcs = [];
const loreStones = [];
const portals = [];   // sealed future-boss gates

function buildGround() {
  const SEG = 110, SIZE = WORLD_R * 2 + 40;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x4a8a42), cDark = new THREE.Color(0x2c5a34),
        cStone = new THREE.Color(0x4a4a58), cSand = new THREE.Color(0x6b5f45);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundH(x, z);
    pos.setY(i, h);
    const n = Math.sin(x * 0.3) * Math.cos(z * 0.27);
    tmp.copy(cGrass).lerp(cDark, 0.5 + 0.5 * n);
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 8) tmp.lerp(cStone, 0.75);
    if (Math.hypot(x, z - 20) < 20) tmp.lerp(cSand, 0.25);
    const cr = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    tmp.offsetHSL(0, 0, cr * 0.02);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  worldGroup.add(m);
}

function scatterNature() {
  // Ionian blossom trees + pines via InstancedMesh
  const treeSpots = [];
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * (WORLD_R - 30);
    const x = Math.cos(a) * r, z = Math.sin(a) * r + -30;
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 10) continue;
    if (Math.hypot(x, z - 20) < 16) continue;
    treeSpots.push({ x, z, s: 0.7 + Math.random() * 0.9, blossom: Math.random() < 0.45 });
  }
  // Voxel canopy trees: chunky trunk + clustered cube crowns (reference look)
  const trunkG = new THREE.BoxGeometry(0.55, 3.4, 0.55);
  const cubeG = new THREE.BoxGeometry(1, 1, 1);
  const trunkI = new THREE.InstancedMesh(trunkG, MAT.trunk, treeSpots.length);
  const CAP = 6;
  const leafI = new THREE.InstancedMesh(cubeG, MAT.leaf, treeSpots.length * CAP);
  const blosI = new THREE.InstancedMesh(cubeG, MAT.blossom, treeSpots.length * CAP);
  const d = new THREE.Object3D();
  let li = 0, bi = 0;
  const off = [[0, 4.6, 0, 2.4], [1.3, 3.8, 0.4, 1.5], [-1.2, 3.9, -0.4, 1.5], [0.3, 3.7, -1.2, 1.4], [-0.3, 5.6, 0.2, 1.5], [0, 3.1, 0.9, 1.3]];
  treeSpots.forEach((t, i) => {
    const y = groundH(t.x, t.z);
    d.position.set(t.x, y + 1.7 * t.s, t.z); d.scale.setScalar(t.s);
    d.rotation.y = Math.random() * 6; d.updateMatrix();
    trunkI.setMatrixAt(i, d.matrix);
    for (const [ox, oy, oz, s] of off) {
      d.position.set(t.x + ox * t.s, y + oy * t.s, t.z + oz * t.s);
      d.scale.setScalar(s * t.s); d.rotation.y = Math.random() * 6; d.updateMatrix();
      if (t.blossom) blosI.setMatrixAt(bi++, d.matrix); else leafI.setMatrixAt(li++, d.matrix);
    }
    colliders.push({ x: t.x, z: t.z, r: 0.7 });
  });
  leafI.count = li; blosI.count = bi;
  trunkI.castShadow = leafI.castShadow = blosI.castShadow = true;
  worldGroup.add(trunkI, leafI, blosI);
  // grass tufts
  const gg = new THREE.ConeGeometry(0.22, 0.9, 4);
  const gm = new THREE.MeshLambertMaterial({ color: 0x4f9a44 });
  const gi = new THREE.InstancedMesh(gg, gm, 900);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * WORLD_R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 20;
    d.position.set(x, groundH(x, z) + 0.35, z);
    d.scale.setScalar(0.6 + Math.random()); d.rotation.y = Math.random() * 6; d.updateMatrix();
    gi.setMatrixAt(i, d.matrix);
  }
  worldGroup.add(gi);
  // rocks
  const rg = new THREE.DodecahedronGeometry(1, 0);
  const ri = new THREE.InstancedMesh(rg, MAT.darkStone, 90);
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * (WORLD_R - 20);
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 20;
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 6) { d.scale.setScalar(0.01); }
    else d.scale.set(0.5 + Math.random() * 1.6, 0.4 + Math.random() * 1.2, 0.5 + Math.random() * 1.6);
    d.position.set(x, groundH(x, z) + 0.3, z); d.rotation.set(Math.random(), Math.random() * 6, Math.random());
    d.updateMatrix(); ri.setMatrixAt(i, d.matrix);
    colliders.push({ x, z, r: 1.1 });
  }
  ri.castShadow = true; worldGroup.add(ri);
}

function toriiGate(x, z, ry, s = 1) {
  const g = new THREE.Group();
  const y = groundH(x, z);
  g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(s);
  g.add(box(0.5, 5, 0.5, MAT.wood, -2.4, 2.5, 0));
  g.add(box(0.5, 5, 0.5, MAT.wood, 2.4, 2.5, 0));
  g.add(box(6.4, 0.6, 0.8, MAT.darkWood, 0, 5.1, 0));
  g.add(box(5.2, 0.4, 0.6, MAT.darkWood, 0, 4.1, 0));
  worldGroup.add(g);
  colliders.push({ x: x - Math.cos(ry) * 2.4, z: z + Math.sin(ry) * 2.4, r: 0.6 });
  colliders.push({ x: x + Math.cos(ry) * 2.4, z: z + Math.sin(ry) * 2.4, r: 0.6 });
}
function stoneLantern(x, z) {
  const g = new THREE.Group(); const y = groundH(x, z);
  g.position.set(x, y, z);
  g.add(box(0.7, 0.4, 0.7, MAT.darkStone, 0, 0.2, 0));
  g.add(box(0.34, 1.2, 0.34, MAT.stone, 0, 1.0, 0));
  g.add(box(0.6, 0.5, 0.6, MAT.darkStone, 0, 1.85, 0));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.4), MAT.lantern);
  glow.position.set(0, 1.85, 0); g.add(glow);
  g.add(box(0.8, 0.2, 0.8, MAT.darkStone, 0, 2.2, 0));
  const l = new THREE.PointLight(0xff9a4a, 0.8, 14); l.position.set(0, 2.4, 0); g.add(l);
  worldGroup.add(g);
  colliders.push({ x, z, r: 0.6 });
}
function templeHall(x, z, ry, ruined = false) {
  const g = new THREE.Group(); const y = groundH(x, z);
  g.position.set(x, y, z); g.rotation.y = ry;
  const W = 12, D = 9, H = 4;
  // floor
  const fl = box(W, 0.5, D, MAT.stone, 0, 0.25, 0); fl.receiveShadow = true; g.add(fl);
  // pillars
  for (const px of [-W / 2 + 1, -W / 4, 0, W / 4, W / 2 - 1]) {
    for (const pz of [-D / 2 + 1, D / 2 - 1]) {
      if (ruined && Math.random() < 0.4) {
        g.add(box(1, 1.2, 1, MAT.mossStone, px, 0.6, pz)); // broken stump
        continue;
      }
      g.add(box(0.9, H, 0.9, MAT.darkStone, px, H / 2 + 0.5, pz));
    }
  }
  // roof
  const roof = box(W + 3, 0.7, D + 3, MAT.roof, 0, H + 1.2, 0);
  roof.rotation.z = 0.02; g.add(roof);
  g.add(box(W * 0.6, 1.2, D * 0.6, MAT.roof, 0, H + 2.1, 0));
  worldGroup.add(g);
  colliders.push({ x, z, r: Math.max(W, D) * 0.42 });
}
function hut(x, z, ry) {
  const g = new THREE.Group(); const y = groundH(x, z);
  g.position.set(x, y, z); g.rotation.y = ry;
  g.add(box(4.4, 2.4, 3.8, MAT.wood, 0, 1.2, 0));
  const roof = box(5.6, 0.5, 5.0, MAT.darkWood, 0, 2.9, 0); roof.rotation.z = 0.06; g.add(roof);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.1), MAT.lantern);
  win.position.set(0, 1.4, 1.95); g.add(win);
  worldGroup.add(g);
  colliders.push({ x, z, r: 3.0 });
}
function shrineBuild(s, idx) {
  const g = new THREE.Group(); const y = groundH(s.x, s.z);
  g.position.set(s.x, y, s.z);
  // stone circle
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.3, 0.4, 12), MAT.mossStone);
  ring.position.y = 0.2; ring.receiveShadow = true; g.add(ring);
  // obelisk
  g.add(box(1.1, 3.2, 1.1, MAT.stone, 0, 1.8, 0));
  g.add(box(1.5, 0.4, 1.5, MAT.darkStone, 0, 3.5, 0));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 6), s.lit ? MAT.lantern : MAT.darkStone);
  flame.position.set(0, 4.2, 0); flame.name = 'flame'; g.add(flame);
  const l = new THREE.PointLight(0x7fd4ff, s.lit ? 1.4 : 0.15, 22);
  l.position.set(0, 4.4, 0); l.name = 'light'; g.add(l);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    stoneLantern(s.x + Math.cos(a) * 6.5, s.z + Math.sin(a) * 6.5);
  }
  worldGroup.add(g);
  s.group = g; s.flame = flame; s.light = l; s.idx = idx;
  colliders.push({ x: s.x, z: s.z, r: 1.2 });
}
function bossArenaBuild() {
  const { x, z, r } = ARENA;
  const y = groundH(x, z);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 2, 1.0, 24),
    new THREE.MeshLambertMaterial({ color: 0x5a5a72 }));
  floor.position.set(x, y + 0.1, z); floor.receiveShadow = true; worldGroup.add(floor);
  // Duel ring pillars with blue flames
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = x + Math.cos(a) * (r - 1), pz = z + Math.sin(a) * (r - 1);
    const py = groundH(px, pz);
    const p = box(1.2, 4.5, 1.2, MAT.stone, px, py + 2.2, pz); worldGroup.add(p);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6), MAT.spirit);
    f.position.set(px, py + 5.0, pz); worldGroup.add(f);
    const li = new THREE.PointLight(0x6fc7ff, 1.0, 18); li.position.set(px, py + 5.4, pz); worldGroup.add(li);
    colliders.push({ x: px, z: pz, r: 1.0 });
  }
  // great torii at entrance
  toriiGate(x, z + r + 4, 0, 1.4);
  // dead blossom tree center-back: gnarled trunk + branches + last pale blooms
  const deadM = new THREE.MeshLambertMaterial({ color: 0x2e2333 });
  const paleM = new THREE.MeshLambertMaterial({ color: 0xc9a0b8, emissive: 0x2a1220 });
  const dt = box(0.9, 7, 0.9, deadM, x, y + 3.5, z - r + 4);
  dt.rotation.z = 0.12; worldGroup.add(dt);
  const br1 = box(0.4, 3.2, 0.4, deadM, x + 1.6, y + 6.4, z - r + 4); br1.rotation.z = -0.7; worldGroup.add(br1);
  const br2 = box(0.4, 2.6, 0.4, deadM, x - 1.5, y + 6.0, z - r + 4.4); br2.rotation.z = 0.7; worldGroup.add(br2);
  worldGroup.add(box(1.6, 1.2, 1.6, paleM, x + 2.9, y + 7.6, z - r + 4));
  worldGroup.add(box(1.4, 1.1, 1.4, paleM, x - 2.7, y + 7.0, z - r + 4.6));
  // sealed future-boss portals around arena rim (expandable!)
  const names = ['zed', 'riven', 'darius', 'jhin', 'katarina', 'aatrox', 'mordekaiser'];
  names.forEach((key, i) => {
    const a = (i / names.length) * Math.PI * 2 + 0.3;
    const px = x + Math.cos(a) * (r + 14), pz = z + Math.sin(a) * (r + 14);
    const py = groundH(px, pz);
    const frame = box(3.2, 4.6, 0.8, MAT.darkStone, px, py + 2.3, pz);
    frame.rotation.y = -a + Math.PI / 2; worldGroup.add(frame);
    const veilMat = new THREE.MeshBasicMaterial({ color: 0x3a1a4a, transparent: true, opacity: 0.75 });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 3.6), veilMat);
    veil.position.set(px, py + 2.2, pz); veil.rotation.y = frame.rotation.y; worldGroup.add(veil);
    portals.push({ key, x: px, z: pz, info: BOSS_REGISTRY[key] });
    colliders.push({ x: px, z: pz, r: 1.6 });
  });
}
function loreStone(x, z, text) {
  const y = groundH(x, z);
  const m = box(1.2, 1.8, 0.5, MAT.mossStone, x, y + 0.9, z);
  m.rotation.y = Math.random() * 3; worldGroup.add(m);
  loreStones.push({ x, z, text });
}
function addPickup(type, x, z, amount = 1) {
  const y = groundH(x, z);
  let mesh;
  if (type === 'gold') mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), MAT.gold);
  else if (type === 'spirit') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 5), MAT.spirit);
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.2), MAT.lantern); // flask refill / blade shard
  mesh.position.set(x, y + 0.9, z);
  worldGroup.add(mesh);
  pickups.push({ mesh, type, amount, taken: false, x, z, bob: Math.random() * 6 });
}

/* ---- Bamboo groves + waterfalls with turquoise pools ---- */
const falls = []; // {tex, x, z}
function bambooGrove(cx, cz, r, n) {
  const trunkG = new THREE.CylinderGeometry(0.09, 0.12, 7, 5);
  const leafG = new THREE.BoxGeometry(1.1, 0.35, 1.1);
  const tm = new THREE.MeshLambertMaterial({ color: 0x3f8a3a });
  const lm = new THREE.MeshLambertMaterial({ color: 0x2c6b2e });
  const ti = new THREE.InstancedMesh(trunkG, tm, n);
  const li = new THREE.InstancedMesh(leafG, lm, n * 2);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    const y = groundH(x, z);
    const s = 0.8 + Math.random() * 0.5;
    d.position.set(x, y + 3.5 * s, z); d.scale.setScalar(s);
    d.rotation.set((Math.random() - 0.5) * 0.1, Math.random() * 6, (Math.random() - 0.5) * 0.1);
    d.updateMatrix(); ti.setMatrixAt(i, d.matrix);
    for (let k = 0; k < 2; k++) {
      d.position.set(x + (Math.random() - 0.5), y + (5.8 + k * 0.9) * s, z + (Math.random() - 0.5));
      d.scale.setScalar(s); d.rotation.y = Math.random() * 6; d.updateMatrix();
      li.setMatrixAt(i * 2 + k, d.matrix);
    }
    colliders.push({ x, z, r: 0.4 });
  }
  ti.castShadow = true; worldGroup.add(ti, li);
}
function waterfall(x, z, w = 5, h = 15) {
  const gy = groundH(x, z);
  worldGroup.add(box(w + 6, h, 4, MAT.darkStone, x, gy + h / 2 - 1, z));
  colliders.push({ x, z, r: w / 2 + 2 });
  const c = document.createElement('canvas'); c.width = 32; c.height = 128;
  const g2 = c.getContext('2d');
  g2.clearRect(0, 0, 32, 128);
  for (let i = 0; i < 40; i++) {
    g2.fillStyle = `rgba(220,245,255,${0.25 + Math.random() * 0.5})`;
    g2.fillRect(Math.random() * 32, Math.random() * 128, 2 + Math.random() * 3, 6 + Math.random() * 14);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  sheet.position.set(x, gy + h / 2 - 1, z + 2.1);
  worldGroup.add(sheet);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(w * 0.9, 14),
    new THREE.MeshLambertMaterial({ color: 0x2fbfae, emissive: 0x0a3a34 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, groundH(x, z + 4) + 0.12, z + 4);
  worldGroup.add(pool);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const rx = x + Math.cos(a) * (w * 0.9 + 1), rz = z + 4 + Math.sin(a) * (w * 0.9 + 1);
    worldGroup.add(box(1 + Math.random(), 0.8 + Math.random() * 0.8, 1 + Math.random(), MAT.darkStone, rx, groundH(rx, rz) + 0.4, rz));
  }
  falls.push({ tex, x, z: z + 4 });
}

/* ---- Sunset sky, Ionian banners, pagoda (reference look) ---- */
let bannerTex = null;
function getBannerTex() {
  if (bannerTex) return bannerTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#1e2c6e'; x.fillRect(0, 0, 64, 96);
  x.fillStyle = '#2e3f9e'; x.fillRect(0, 0, 64, 10);
  x.strokeStyle = '#8fa3e8'; x.lineWidth = 3; x.strokeRect(3, 3, 58, 90);
  x.strokeStyle = '#e8ecff'; x.lineWidth = 5; x.lineCap = 'round';
  x.beginPath();
  for (let a = 0; a < Math.PI * 3.2; a += 0.15) {
    const r = 4 + a * 3.2;
    const px = 32 + Math.cos(a) * r, py = 46 + Math.sin(a) * r;
    if (a === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.stroke();
  bannerTex = new THREE.CanvasTexture(c);
  bannerTex.magFilter = THREE.NearestFilter;
  return bannerTex;
}
function banner(x, z, ry = 0, s = 1) {
  const g = new THREE.Group(); const y = groundH(x, z);
  g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(s);
  g.add(box(0.3, 6.4, 0.3, MAT.darkWood, 0, 3.2, 0));
  g.add(box(2.0, 0.25, 0.25, MAT.darkWood, 0, 6.1, 0));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4),
    new THREE.MeshLambertMaterial({ map: getBannerTex(), side: THREE.DoubleSide }));
  cloth.position.set(-0.15, 4.7, 0); cloth.castShadow = true; g.add(cloth);
  worldGroup.add(g);
  colliders.push({ x, z, r: 0.5 });
}
function pagoda(x, z, tiers = 3) {
  const g = new THREE.Group(); const y = groundH(x, z);
  g.position.set(x, y, z);
  let w = 10;
  for (let i = 0; i < tiers; i++) {
    g.add(box(w, 3.2, w, MAT.wood, 0, 1.6 + i * 3.4, 0));
    g.add(box(w + 3.5, 0.8, w + 3.5, MAT.roof, 0, 3.6 + i * 3.4, 0));
    const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 1.2, 0.1), MAT.lantern);
    win.position.set(0, 1.8 + i * 3.4, w / 2 + 0.03); g.add(win);
    w *= 0.8;
  }
  worldGroup.add(g);
  colliders.push({ x, z, r: 7 });
}
function buildSky() {
  // gradient sunset dome: indigo zenith -> violet -> ember horizon
  const geo = new THREE.SphereGeometry(460, 16, 10);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x1b2350), mid = new THREE.Color(0x7a4a86),
        hor = new THREE.Color(0xff9a5a), bot = new THREE.Color(0x1a1030);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 460;
    if (t > 0.45) tmp.copy(mid).lerp(top, (t - 0.45) / 0.55);
    else if (t > 0) tmp.copy(hor).lerp(mid, t / 0.45);
    else tmp.copy(hor).lerp(bot, Math.min(1, -t * 3));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10; dome.frustumCulled = false;
  scene.add(dome);
  // blocky pixel sun + glow
  const sun = new THREE.Mesh(new THREE.CircleGeometry(20, 4), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sun.position.set(330, 46, -80); sun.lookAt(0, 20, 0); scene.add(sun);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(38, 4),
    new THREE.MeshBasicMaterial({ color: 0xff9a5a, transparent: true, opacity: 0.4, fog: false, depthWrite: false }));
  glow.position.copy(sun.position); glow.lookAt(0, 20, 0); scene.add(glow);
  // blocky clouds
  const cloudCols = [0xe8a0b8, 0x9a6fae, 0xffc98a];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: cloudCols[i % 3], fog: false }));
    const a = Math.random() * Math.PI * 2, r = 180 + Math.random() * 200;
    m.position.set(Math.cos(a) * r, 70 + Math.random() * 70, Math.sin(a) * r - 20);
    m.scale.set(20 + Math.random() * 30, 3 + Math.random() * 4, 8 + Math.random() * 10);
    m.rotation.y = Math.random() * 3;
    scene.add(m);
  }
  // distant mountain silhouettes (pyramids sitting on the horizon)
  const mMat = new THREE.MeshBasicMaterial({ color: 0x352a5e, fog: false });
  const peakG = new THREE.ConeGeometry(1, 1, 4);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.55;
    const m = new THREE.Mesh(peakG, mMat);
    const r = 380 + Math.random() * 40;
    const h = 70 + Math.random() * 60, w = 60 + Math.random() * 50;
    m.position.set(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r - 20);
    m.scale.set(w, h, w);
    m.rotation.y = Math.random() * 3;
    scene.add(m);
  }
}

function buildWorld() {
  buildSky();
  buildGround();
  scatterNature();
  // spawn glade: shrine 0 + torii + lanterns
  shrineBuild(shrines[0], 0);
  toriiGate(0, 32, 0, 1.1);
  stoneLantern(4, 26); stoneLantern(-4, 26);
  // sunken village (west): huts + shrine 1
  const village = [[-72, -34], [-64, -46], [-78, -48], [-66, -30]];
  village.forEach(([x, z], i) => hut(x, z, i * 0.7));
  shrineBuild(shrines[1], 1);
  templeHall(-58, -52, 0.4, true);
  // temple approach (east): halls + shrine 2
  templeHall(58, -66, -0.3, false);
  templeHall(72, -80, 0.2, true);
  shrineBuild(shrines[2], 2);
  toriiGate(48, -52, 0.6, 1.2);
  toriiGate(60, -92, -0.2, 1.2);
  // caves-ish: dark rock arch north-east
  for (let i = 0; i < 6; i++) {
    const x = 90 + Math.cos(i * 1.1) * 8, z = -10 + i * 5;
    const m = box(3 + Math.random() * 2, 5 + Math.random() * 3, 3, MAT.darkStone, x, groundH(x, z) + 2, z);
    m.rotation.y = Math.random(); worldGroup.add(m);
    colliders.push({ x, z, r: 2.4 });
  }
  addPickup('blade', 96, 2, 1); // hidden legendary shard
  // lore
  loreStone(3, 14, 'The wind does not teach. It only reveals. — Souma');
  loreStone(-62, -38, 'When the village burned, no sword was drawn. That was the crime.');
  loreStone(54, -60, 'The Forgotten Temple seals seven shadows. One brother walks among them.');
  loreStone(0, -88, 'Yone waits where the blossoms fall upward. Steel yourself.');
  // pickups
  addPickup('spirit', 10, 8); addPickup('spirit', -12, 30); addPickup('gold', 20, -10, 15);
  addPickup('gold', -50, -20, 20); addPickup('spirit', 44, -48); addPickup('flask', -66, -38);
  addPickup('gold', 66, -72, 25); addPickup('spirit', 8, -60);
  // boss arena
  bossArenaBuild();
  // pagoda overlook + Ionian war banners along the roads
  pagoda(105, -45, 3);
  bambooGrove(38, 58, 16, 26);
  bambooGrove(-95, 30, 14, 20);
  waterfall(130, -15, 5, 15);
  waterfall(-100, 55, 4, 12);
  banner(3.5, 30); banner(-3.5, 30);
  banner(-64, -32, 0.4); banner(54, -58, -0.4);
  banner(-5, ARENA.z + ARENA.r + 9, 0, 1.2); banner(5, ARENA.z + ARENA.r + 9, 0, 1.2);
  banner(44, -50, 0.6); banner(64, -94, -0.2);
  // NPC monk near spawn
  spawnMonk(6, 24);
}

function spawnMonk(x, z) {
  const f = makeHero({ simple: true, skin: 0xb08a64, wrap: '#8a6a3a', hak: '#4a3a24', hair: 0x888888 });
  f.swordPivot.visible = false; // a monk carries no drawn blade
  f.group.position.set(x, groundH(x, z), z);
  f.group.rotation.y = 2.4;
  scene.add(f.group);
  npcs.push({ mesh: f, x, z, lines: [
    'Wanderer… the Forgotten Realm keeps what Ionia lost.',
    'Touch the shrines. They remember you, even if none else do.',
    'Your brother Yone waits north, past the temple gates. His spirit blade thirsts.',
    'Two taps of Steel Tempest, wanderer — the third calls the storm. Knock him skyward, then… Last Breath.',
  ], idx: 0, cd: 0 });
}

/* ============ PARTICLES ============ */
const Particles = {
  pool: [], MAX: 500,
  init() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.MAX * 3);
    this.col = new Float32Array(this.MAX * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    this.mat = new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < this.MAX; i++) this.pool.push({ life: 0, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
    // ambient falling leaves / embers
    this.ambient = [];
    for (let i = 0; i < 120; i++) {
      this.ambient.push({ x: (Math.random() - 0.5) * 200, y: Math.random() * 20, z: (Math.random() - 0.5) * 200 });
    }
    const ag = new THREE.BufferGeometry();
    this.apos = new Float32Array(120 * 3);
    ag.setAttribute('position', new THREE.BufferAttribute(this.apos, 3));
    this.amb = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.22, color: 0xd98ab5, transparent: true, opacity: 0.7, depthWrite: false }));
    this.amb.frustumCulled = false;
    scene.add(this.amb);
  },
  spawn(x, y, z, n, color, speed = 5, up = 3) {
    const c = new THREE.Color(color);
    let s = 0;
    for (const p of this.pool) {
      if (p.life > 0) continue;
      p.life = 0.5 + Math.random() * 0.5;
      p.max = p.life;
      p.x = x; p.y = y; p.z = z;
      p.vx = (Math.random() - 0.5) * speed * 2;
      p.vy = Math.random() * up + 1;
      p.vz = (Math.random() - 0.5) * speed * 2;
      p.r = c.r; p.g = c.g; p.b = c.b;
      if (++s >= n) break;
    }
  },
  slash(x, y, z, dirYaw) {
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Color(0xcfefff);
      for (const p of this.pool) {
        if (p.life > 0) continue;
        p.life = p.max = 0.35;
        const t = (Math.random() - 0.5) * 2.4;
        p.x = x + Math.cos(dirYaw) * t; p.y = y + (Math.random() - 0.5) * 1.4; p.z = z + Math.sin(dirYaw) * t;
        p.vx = Math.cos(dirYaw + Math.PI / 2) * 8 * (Math.random() > 0.5 ? 1 : -1);
        p.vy = 1; p.vz = Math.sin(dirYaw + Math.PI / 2) * 8 * (Math.random() > 0.5 ? 1 : -1);
        p.r = c.r; p.g = c.g; p.b = c.b;
        break;
      }
    }
  },
  update(dt, px, pz) {
    for (let i = 0; i < this.MAX; i++) {
      const p = this.pool[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 9 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.life <= 0) p.y = -99;
      }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.life > 0 ? p.y : -99; this.pos[i * 3 + 2] = p.z;
      const f = Math.max(0, p.life / (p.max || 1));
      this.col[i * 3] = p.r * f; this.col[i * 3 + 1] = p.g * f; this.col[i * 3 + 2] = p.b * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    for (let i = 0; i < this.ambient.length; i++) {
      const a = this.ambient[i];
      a.y -= dt * 0.8; a.x += dt * 0.7;
      if (a.y < 0 || Math.hypot(a.x - px, a.z - pz) > 120) {
        a.x = px + (Math.random() - 0.5) * 160; a.z = pz + (Math.random() - 0.5) * 160; a.y = 10 + Math.random() * 12;
      }
      this.apos[i * 3] = a.x; this.apos[i * 3 + 1] = a.y; this.apos[i * 3 + 2] = a.z;
    }
    this.amb.geometry.attributes.position.needsUpdate = true;
  }
};

/* ============ PROJECTILES / WALLS / TELEGRAPHS ============ */
const projectiles = []; // {mesh, x,y,z, vx,vz, dmg, from, life, friendly, radius}
const walls = [];       // {mesh, x,z, yaw, life, w}
const telegraphs = [];  // {mesh, x,z, r, delay, dmg, from, t}
const rings = [];       // expanding shockwave visuals {mesh, t}
function ringMesh(x, y, z, color = 0xcfefff, size = 2) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(size, 0.18, 8, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
  m.position.set(x, y, z); m.rotation.x = Math.PI / 2;
  scene.add(m);
  return m;
}
function spawnProjectile(x, y, z, dx, dz, speed, dmg, from, friendly, color = 0xff5566, life = 3) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5),
    new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const len = Math.hypot(dx, dz) || 1;
  projectiles.push({ mesh, x, y, z, vx: dx / len * speed, vz: dz / len * speed, dmg, from, life, friendly });
}
function spawnTelegraph(x, z, r, delay, dmg, from) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 24), MAT.red.clone());
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, groundH(x, z) + 0.15, z);
  scene.add(mesh);
  telegraphs.push({ mesh, x, z, r, delay, t: 0, dmg, from });
}

/* ============ GAME STATE ============ */
const Game = {
  state: 'title', paused: false, time: 0, mouseLook: true,
  camYaw: Math.PI, camPitch: 0.32, camDist: 7.5, shake: 0,
  lockTarget: null, bossActive: false, bossIntroDone: false, bossDefeated: false,
  slowT: 0, camKick: 0, mistT: 0,
  enemies: [], boss: null, chargeHeld: 0, wasRDown: false, wasMouse: false,
  subtitles: [], interactTarget: null,
  toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = msg;
    $('toast-wrap').appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 400); }, 3200);
  },
  subtitle(text, dur = 3.5) {
    $('subtitle').textContent = text;
    clearTimeout(this._subT);
    this._subT = setTimeout(() => { $('subtitle').textContent = ''; }, dur * 1000);
  },
  toggleLockOn() {
    if (this.state !== 'playing') return;
    if (this.lockTarget) { this.lockTarget = null; this.toast('🔓 Lock released'); return; }
    let best = null, bd = 34;
    const all = [...this.enemies, ...(this.boss && !this.boss.dead ? [this.boss] : [])];
    for (const e of all) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - Player.x, e.z - Player.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) { this.lockTarget = best; AudioSys.tone(700, 0.12, 'sine', 0.08); this.toast('🔒 Locked: ' + best.label); }
  },
  togglePause() {
    if (this.state !== 'playing') return;
    this.paused = !this.paused;
    $('pause-screen').classList.toggle('hidden', !this.paused);
    if (this.paused) this.renderStats();
  },
  renderStats() {
    $('stat-sheet').innerHTML =
      `LEVEL ${Player.level} &nbsp;·&nbsp; XP ${Player.xp}/${Player.xpNeed} &nbsp;·&nbsp; ◈ ${Player.gold}<br>` +
      `ATK ${Player.atk} &nbsp;·&nbsp; MAX HP ${Player.maxHp} &nbsp;·&nbsp; FLASKS ${Player.flasks}<br>` +
      `${this.bossDefeated ? '👑 YONE FELLED — Moonfall Blade attuned' : '⚔ Yone awaits in the northern arena'}`;
  },
  save() {
    writeSave({
      level: Player.level, xp: Player.xp, gold: Player.gold, atk: Player.atk,
      maxHp: Player.maxHp, blade: Player.blade, shrine: Player.shrineIdx,
      bossDefeated: this.bossDefeated,
    });
  },
  die(cause) {
    if (this.state !== 'playing' || Player.dead) return;
    Player.dead = true; Player.hp = 0;
    AudioSys.death();
    updateHUD();
    setTimeout(() => {
      this.state = 'dead';
      $('death-cause').textContent = cause || 'Cut down in the Forgotten Realm.';
      $('death-screen').classList.remove('hidden');
      document.exitPointerLock?.();
    }, 900);
  },
  respawn() {
    $('death-screen').classList.add('hidden');
    const s = shrines[Player.shrineIdx] || shrines[0];
    Player.x = s.x + 3; Player.z = s.z + 3;
    Player.hp = Player.maxHp; Player.st = Player.maxSt; Player.flasks = Player.maxFlasks;
    Player.dead = false; Player.vx = Player.vz = 0;
    // reset regular enemies, boss resets if it was active
    for (const e of this.enemies) if (e.dead) respawnEnemy(e);
    if (this.boss && this.bossActive && !this.bossDefeated) resetBoss(this.boss);
    this.bossActive = false; this.lockTarget = null;
    $('boss-bar-wrap').classList.add('hidden');
    this.state = 'playing';
    this.subtitle('The shrine\'s cold light knits your wounds. Rise, wanderer.');
    AudioSys.shrine();
    updateHUD();
  },
  victory() {
    this.bossDefeated = true;
    Player.gold += 500; Player.blade = 'MOONFALL BLADE'; Player.atk += 8;
    this.save();
    $('victory-text').textContent =
      'The Unforgotten kneels. “So… the wind chose you after all, little brother.” His spirit blade shatters into moonlight — and its edge chooses your hand.';
    $('victory-rewards').innerHTML =
      `<div class="reward">🌙 MOONFALL BLADE (+8 ATK)</div><div class="reward">◈ +500 gold</div><div class="reward">⚱ Flask +1 forever</div>`;
    Player.maxFlasks += 1; Player.flasks = Player.maxFlasks;
    setTimeout(() => {
      this.state = 'victory';
      $('victory-screen').classList.remove('hidden');
      document.exitPointerLock?.();
    }, 2200);
  },
};

/* ============ PLAYER (Yasuo) ============ */
const Player = {
  x: 0, z: 20, y: 0, vx: 0, vz: 0, vy: 0, yaw: Math.PI, grounded: true,
  hp: 100, maxHp: 100, st: 100, maxSt: 100, flasks: 3, maxFlasks: 3,
  level: 1, xp: 0, xpNeed: 100, gold: 0, atk: 10, blade: 'WEATHERED KATANA',
  dead: false, iframes: 0, rollT: 0, rollDX: 0, rollDZ: 0, atkT: 0, atkKind: null,
  combo: 0, comboWin: 0, comboHits: 0, comboT: 0, heavyT: 0, flaskT: 0,
  qStack: 0, qStackT: 0, cd: { Q: 0, W: 0, E: 0, R: 0, F: 0 },
  eDashT: 0, eDX: 0, eDZ: 0, ultT: 0, ultTarget: null,
  flow: 0, hurtT: 0, crouchT: 0, spinT: 0, whiffT: 0, lastAction: -99, wasArmed: false,
  animT: 0, moving: false, sprinting: false, shrineIdx: 0,
  gainXp(n) {
    this.xp += n;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed; this.level++;
      this.xpNeed = Math.floor(this.xpNeed * 1.5);
      this.maxHp += 12; this.hp = Math.min(this.maxHp, this.hp + 40);
      this.atk += 2; this.maxSt += 5; this.st = this.maxSt;
      Game.toast(`✨ LEVEL ${this.level}! +ATK +HP (blade hunger grows)`);
      AudioSys.levelup();
      Particles.spawn(this.x, this.y + 1.5, this.z, 30, 0xffe9a8, 4, 6);
    }
    Game.save();
  },
};

/* ============ ENEMIES ============ */
function spawnEnemy(type, x, z) {
  const defs = {
    husk:   { hp: 55, dmg: 10, speed: 4.2, xp: 22, gold: 8, label: 'Hollow Husk', cloth: 0x4a3a52, scale: 1 },
    archer: { hp: 40, dmg: 8, speed: 3.6, xp: 30, gold: 12, label: 'Ash Archer', cloth: 0x5d3a2e, scale: 0.95 },
    brute:  { hp: 130, dmg: 20, speed: 3.0, xp: 65, gold: 25, label: 'Cursed Brute', cloth: 0x2e2e3e, scale: 1.25 },
  };
  const d = defs[type];
  const palettes = {
    husk: { skin: 0x9a8a7a, wrap: '#4a3a5e', hak: '#2a2a3a', hair: 0x1a1a1a, pupil: 0x881111 },
    archer: { skin: 0xa08a6a, wrap: '#5e3a2e', hak: '#33241e', hair: 0x1a1a1a, pupil: 0x881111 },
    brute: { skin: 0x8a7a6e, wrap: '#2e2e40', hak: '#1e1e28', hair: 0x111116, pupil: 0xaa2222 },
  };
  const f = makeHero({ simple: true, steel: 0x8a94a8, ...palettes[type] });
  f.group.scale.setScalar(d.scale);
  scene.add(f.group);
  const e = {
    kind: 'mob', type, x, z, y: groundH(x, z), yaw: 0, hp: d.hp, maxHp: d.hp,
    dmg: d.dmg, speed: d.speed, xp: d.xp, gold: d.gold, label: d.label,
    mesh: f, dead: false, state: 'idle', atkT: 0, cool: Math.random() * 2,
    stagger: 0, airT: 0, animT: Math.random() * 5, homeX: x, homeZ: z,
    swingId: 0, didHit: false,
  };
  Game.enemies.push(e);
  return e;
}
function respawnEnemy(e) {
  e.dead = false; e.hp = e.maxHp; e.x = e.homeX; e.z = e.homeZ;
  e.state = 'idle'; e.mesh.group.visible = true;
}
function populateEnemies() {
  const camps = [
    { x: 30, z: -20, n: 3 }, { x: -40, z: 10, n: 3 }, { x: -55, z: -25, n: 2 },
    { x: 45, z: -40, n: 3 }, { x: 70, z: -60, n: 2 }, { x: -20, z: -70, n: 3 },
    { x: 30, z: -95, n: 2 }, { x: -90, z: -10, n: 2 },
  ];
  const types = ['husk', 'husk', 'archer', 'brute'];
  for (const c of camps) {
    for (let i = 0; i < c.n; i++) {
      const t = types[Math.floor(Math.random() * types.length)];
      spawnEnemy(t, c.x + (Math.random() - 0.5) * 10, c.z + (Math.random() - 0.5) * 10);
    }
  }
}

/* ---- YONE BOSS ---- */
function spawnBoss() {
  const f = makeHero({ hair: 0x5e1a2a, wrap: '#274a5e', hak: '#1e1e33', dual: true, spirit: true, pupil: 0xff5544 });
  f.group.scale.setScalar(1.12);
  f.sheath.visible = false; // Yone always fights drawn
  scene.add(f.group);
  const b = {
    kind: 'boss', type: 'yone', label: 'Yone',
    x: ARENA.x, z: ARENA.z - 8, y: groundH(ARENA.x, ARENA.z - 8), yaw: 0,
    hp: 1400, maxHp: 1400, dmg: 18, speed: 5.2,
    xp: 500, gold: 500, mesh: f, dead: false,
    state: 'dormant', atkT: 0, cool: 2, stagger: 0, airT: 0, animT: 0,
    phase: 1, pattern: [], didHit: false, swingId: 0, introT: 0, enraged: false,
  };
  Game.boss = b;
  return b;
}
function resetBoss(b) {
  b.hp = b.maxHp; b.dead = false; b.state = 'dormant'; b.phase = 1;
  b.x = ARENA.x; b.z = ARENA.z - 8; b.mesh.group.visible = true;
  Game.bossIntroDone = false;
}
function bossPhase(b) {
  const f = b.hp / b.maxHp;
  const p = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  if (p !== b.phase) {
    b.phase = p;
    AudioSys.bossRoar();
    Game.subtitle(p === 2 ? 'YONE: “ spirit form… UNBOUND!”' : 'YONE: “ENOUGH. Face the unforgotten!”');
    Particles.spawn(b.x, b.y + 2, b.z, 60, p === 2 ? 0x9fd8ff : 0xff3b30, 8, 8);
    Game.shake = Math.max(Game.shake, 0.7);
    toastPhase(p);
  }
}
function toastPhase(p) {
  Game.toast(p === 2 ? '👹 Yone — Phase II: Spirit Unbound' : '🔥 Yone — FINAL PHASE: Unforgotten Fury');
  $('boss-phase-pips').textContent = p === 1 ? '◆ ◆ ◆' : p === 2 ? '◆ ◆ ◇' : '◆ ◇ ◇';
}
function bossStartAttack(b, name) {
  b.state = 'attack'; b.atkKind = name; b.atkT = 0; b.didHit = false; b.swingId++;
  const face = Math.atan2(Player.x - b.x, Player.z - b.z);
  b.yaw = face;
  if (name === 'dash') AudioSys.dash();
  if (name === 'slam' || name === 'ult') AudioSys.bossRoar();
}

/* ============ COMBAT HELPERS ============ */
function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function hurtEnemy(e, dmg, opts = {}) {
  if (e.dead) return;
  if (e.kind === 'boss' && e.state === 'dormant') return;
  dmg = Math.round(dmg * (0.9 + Math.random() * 0.2));
  e.hp -= dmg;
  e.stagger = Math.max(e.stagger, opts.stagger ?? 0.25);
  Particles.spawn(e.x, e.y + 1.4, e.z, opts.big ? 22 : 10, opts.color || 0xffd0d0, 5, 4);
  if (opts.knockup) { e.airT = Math.max(e.airT, opts.knockup); e.vyAir = 7; }
  if (opts.knockback) {
    const a = Math.atan2(e.x - Player.x, e.z - Player.z);
    e.x += Math.cos(a) * opts.knockback; e.z += Math.sin(a) * opts.knockback;
  }
  if (e.kind === 'boss') bossPhase(e);
  AudioSys.hit();
  Player.comboHits++; Player.comboT = 2.2;
  if (e.hp <= 0) killEnemy(e);
  else if (e.kind === 'mob' && e.state !== 'attack') e.state = 'chase';
  updateHUD();
}
function killEnemy(e) {
  e.dead = true; e.hp = 0;
  e.deathT = 0;
  Particles.spawn(e.x, e.y + 1, e.z, 40, e.kind === 'boss' ? 0x9fd8ff : 0xff5040, 7, 7);
  AudioSys.heavyHit();
  Player.gainXp(e.xp); Player.gold += e.gold;
  Game.toast(`${e.kind === 'boss' ? '👑' : '⚔'} ${e.label} slain  +${e.xp} XP  +${e.gold}◈`);
  if (Math.random() < 0.3) addPickup('spirit', e.x + 1, e.z);
  if (Math.random() < 0.2) addPickup('gold', e.x - 1, e.z, 10);
  if (Game.lockTarget === e) Game.lockTarget = null;
  if (e.kind === 'boss') {
    Game.bossActive = false;
    $('boss-bar-wrap').classList.add('hidden');
    Game.subtitle('YONE: “…finish it, little brother.”');
    Game.victory();
  }
}
function hurtPlayer(dmg, fromX, fromZ, label) {
  if (Player.dead || Player.iframes > 0 || Player.rollT > 0 || Game.state !== 'playing') return;
  if (Player.ultT > 0) return; // untouchable during Last Breath
  dmg = Math.round(dmg * (0.85 + Math.random() * 0.3));
  Player.hp -= dmg;
  Player.lastAction = Game.time;
  Player.hurtT = 0.3;
  // Way of the Wanderer: a full Flow meter bursts into a wind shield
  if (Player.flow >= 100) {
    Player.flow = 0;
    const absorbed = Math.min(60, dmg);
    Player.hp += absorbed;
    rings.push({ mesh: ringMesh(Player.x, Player.y + 1.2, Player.z, 0xbfe9ff, 3), t: 0 });
    Particles.spawn(Player.x, Player.y + 1.4, Player.z, 40, 0xbfe9ff, 7, 6);
    AudioSys.wall();
    Game.toast('🌪️ WINDSHIELD — Flow consumed!');
  }
  Player.iframes = 0.5;
  Game.shake = Math.max(Game.shake, 0.5);
  $('damage-flash').style.opacity = '1';
  setTimeout(() => { $('damage-flash').style.opacity = '0'; }, 120);
  AudioSys.hit();
  Particles.spawn(Player.x, Player.y + 1.4, Player.z, 12, 0xff2222, 5, 4);
  updateHUD();
  if (Player.hp <= 0) {
    Player.hp = 0;
    Game.die(label || 'Cut down in the Forgotten Realm.');
  }
}

/* Player attacks */
function softFace(maxD = 5) {
  // face the nearest enemy when not hard-locked (action-game strike assist)
  if (Game.lockTarget && !Game.lockTarget.dead) {
    Player.yaw = Math.atan2(Game.lockTarget.x - Player.x, Game.lockTarget.z - Player.z);
    return;
  }
  let best = null, bd = maxD;
  const targets = [...Game.enemies, ...(Game.boss && !Game.boss.dead && Game.boss.state !== 'dormant' ? [Game.boss] : [])];
  for (const e of targets) {
    if (e.dead) continue;
    const d = dist2(Player.x, Player.z, e.x, e.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (best) Player.yaw = Math.atan2(best.x - Player.x, best.z - Player.z);
}
function tryLight() {
  if (Player.atkT > 0 || Player.eDashT > 0 || Player.ultT > 0 || Player.rollT > 0) return;
  if (Player.st < 8) { Game.toast('😮‍💨 Out of stamina!'); return; }
  Player.st -= 8;
  Player.lastAction = Game.time;
  if (Player.comboWin <= 0) Player.combo = 0;
  Player.combo = (Player.combo % 3) + 1;
  Player.comboWin = 1.1;
  Player.atkT = 0.42; Player.atkKind = 'light' + Player.combo;
  Player.animT = 0; Player.didHitP = false;
  AudioSys.swing();
  // face lock target or move dir
  softFace();
}
function tryHeavy(charged) {
  if (Player.atkT > 0 || Player.eDashT > 0 || Player.ultT > 0 || Player.rollT > 0) return;
  if (Player.st < (charged ? 25 : 15)) { Game.toast('😮‍💨 Out of stamina!'); return; }
  Player.st -= charged ? 25 : 15;
  Player.lastAction = Game.time;
  Player.atkT = charged ? 0.8 : 0.55;
  Player.atkKind = charged ? 'charged' : 'heavy';
  Player.animT = 0; Player.didHitP = false;
  AudioSys.swing();
  softFace();
}
function meleeArc(dmg, range, arc, opts = {}) {
  const targets = [...Game.enemies, ...(Game.boss && !Game.boss.dead ? [Game.boss] : [])];
  let hitAny = false;
  for (const e of targets) {
    if (e.dead) continue;
    if (e.kind === 'boss' && e.state === 'dormant') continue;
    const d = dist2(Player.x, Player.z, e.x, e.z);
    if (d > range + 0.6) continue;
    const ang = Math.atan2(e.x - Player.x, e.z - Player.z);
    let diff = Math.abs(((ang - Player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > arc / 2 && d > 1.2) continue;
    hurtEnemy(e, dmg * (Player.blade === 'MOONFALL BLADE' ? 1.25 : 1), opts);
    hitAny = true;
  }
  Particles.slash(Player.x + Math.sin(Player.yaw) * 1.6, Player.y + 1.4, Player.z + Math.cos(Player.yaw) * 1.6, Player.yaw);
  return hitAny;
}
function castQ() {
  if (Player.cd.Q > 0 || Player.ultT > 0) return;
  if (Player.st < 10) { Game.toast('😮‍💨 Out of stamina!'); return; }
  Player.st -= 10; Player.cd.Q = 4;
  Player.lastAction = Game.time;
  Player.qStack++; Player.qStackT = 6;
  softFace();
  AudioSys.swing();
  Player.animT = 0; Player.atkT = Math.max(Player.atkT, 0.3); Player.atkKind = 'q';
  const dx = Math.sin(Player.yaw), dz = Math.cos(Player.yaw);
  const dashing = Player.eDashT > 0;
  if (dashing) {
    // Q DURING DASH: spinning circular strike, ring of wind (LoL EQ)
    Player.atkKind = 'qspin'; Player.spinT = 0.45;
    meleeArc(30 + Player.atk, 4.6, 6.4, { knockback: 3, big: true, color: 0xcfefff });
    rings.push({ mesh: ringMesh(Player.x, Player.y + 1, Player.z, 0xcfefff, 1.5), t: 0 });
    AudioSys.tornado();
  } else if (Player.qStack >= 3) {
    Player.qStack = 0;
    AudioSys.tornado();
    Game.shake = Math.max(Game.shake, 0.4);
    // tornado projectile: travels, knockups everything
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.35, 6, 12), MAT.wind.clone());
    mesh.position.set(Player.x + dx * 2, Player.y + 1.2, Player.z + dz * 2);
    scene.add(mesh);
    projectiles.push({
      mesh, tornado: true, spin: 0, x: Player.x + dx * 2, y: Player.y + 1.2, z: Player.z + dz * 2,
      vx: dx * 14, vz: dz * 14, dmg: 30 + Player.atk, from: 'player', life: 1.6, friendly: true,
    });
    Game.toast('🌪️ STEEL TEMPEST — TORNADO! (R now if airborne)');
  } else {
    // short-range thrust slash
    meleeArc(20 + Player.atk, 4.2, 1.2, { stagger: 0.3 });
    spawnProjectile(Player.x + dx * 1.5, Player.y + 1.4, Player.z + dz * 1.5, dx, dz, 26, 8 + Player.atk * 0.4, 'player', true, 0xcfefff, 0.5);
  }
  updateHUD();
}
function castW() {
  if (Player.cd.W > 0 || Player.ultT > 0) return;
  Player.cd.W = 14;
  Player.lastAction = Game.time;
  Player.atkT = 0.4; Player.atkKind = 'wcast'; Player.animT = 0; Player.didHitP = true;
  AudioSys.wall();
  const dx = Math.sin(Player.yaw), dz = Math.cos(Player.yaw);
  const wx = Player.x + dx * 2.5, wz = Player.z + dz * 2.5;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), MAT.wall.clone());
  mesh.position.set(wx, groundH(wx, wz) + 1.6, wz);
  mesh.rotation.y = Player.yaw;
  scene.add(mesh);
  walls.push({ mesh, x: wx, z: wz, yaw: Player.yaw, life: 4, w: 7 });
  Particles.spawn(wx, Player.y + 1.6, wz, 20, 0xbfe9ff, 4, 3);
  Game.toast('🌀 WIND WALL — projectiles blocked');
}
function castE() {
  if (Player.cd.E > 0 || Player.eDashT > 0 || Player.ultT > 0) return;
  if (Player.st < 12) { Game.toast('😮‍💨 Out of stamina!'); return; }
  Player.st -= 12; Player.cd.E = 6;
  Player.lastAction = Game.time;
  AudioSys.dash();
  softFace();
  let dx = Math.sin(Player.yaw), dz = Math.cos(Player.yaw);
  if (Game.lockTarget && !Game.lockTarget.dead) {
    const a = Math.atan2(Game.lockTarget.x - Player.x, Game.lockTarget.z - Player.z);
    Player.yaw = a; dx = Math.sin(a); dz = Math.cos(a);
  }
  Player.eDashT = 0.28; Player.eDX = dx; Player.eDZ = dz; Player.eHit = new Set();
  Player.eSide = Math.random() < 0.5 ? -1 : 1;
}
function castR() {
  if (Player.cd.R > 0 || Player.ultT > 0) return;
  const targets = [...Game.enemies, ...(Game.boss && !Game.boss.dead ? [Game.boss] : [])];
  const airborne = targets.filter(e => !e.dead && e.airT > 0 && dist2(Player.x, Player.z, e.x, e.z) < 26);
  if (!airborne.length) { Game.toast('🌪️ R needs an AIRBORNE enemy — land a tornado first!'); AudioSys.tone(200, 0.2, 'square', 0.08); return; }
  airborne.sort((a, b) => dist2(Player.x, Player.z, a.x, a.z) - dist2(Player.x, Player.z, b.x, b.z));
  const t = airborne[0];
  Player.cd.R = 30; Player.ultT = 1.6; Player.ultTarget = t; Player.ultTick = 0;
  Player.lastAction = Game.time;
  Player.ultFrom = { x: Player.x, z: Player.z };
  AudioSys.bossRoar(); AudioSys.tornado();
  Game.subtitle('YASUO: “HASAGI — LAST BREATH!”');
  Game.shake = 0.6;
  // cinematic beat: time dilates, camera pulls back, wind streak to the target
  Game.slowT = 0.55; Game.camKick = 4.5;
  for (let i = 0; i < 24; i++) {
    const k = i / 24;
    Particles.spawn(
      Player.ultFrom.x + (t.x - Player.ultFrom.x) * k,
      Player.y + 1.5 + Math.sin(k * Math.PI) * 2,
      Player.ultFrom.z + (t.z - Player.ultFrom.z) * k,
      1, 0xcfefff, 1, 1);
  }
}
function drinkFlask() {
  if (Player.cd.F > 0 || Player.flasks <= 0 || Player.ultT > 0) {
    if (Player.flasks <= 0) Game.toast('⚱ No flasks! Rest at a shrine.');
    return;
  }
  Player.flasks--; Player.cd.F = 1.2; Player.flaskT = 2.0;
  AudioSys.drink();
  $('heal-flash').style.opacity = '1';
  setTimeout(() => { $('heal-flash').style.opacity = '0'; }, 500);
  updateHUD();
}

/* Pixel portrait (reference HUD): 14x14 Yasuo face, drawn once */
function drawPortrait() {
  const cv = $('portrait'); if (!cv) return;
  const x = cv.getContext('2d');
  const P = { H: '#2b2440', S: '#d9a066', W: '#f2f2f2', P: '#14141c', B: '#2e3f9e', T: '#c9a227', D: '#1e2c6e', R: '#8a2a2a', '.': '#10101c' };
  const rows = [
    '.....RR.......',
    '....HHHHHH....',
    '....HHHHHH....',
    '...HHHHHHHH...',
    '...HSSSSSSH...',
    '...SWPSSPWS...',
    '...SSSSSSSS...',
    '...BBBBBBBB...',
    '...BBTTBBBB...',
    '...BBBBBBBB...',
    '...DDDDDDDD...',
    '...DDDDDDDD...',
    '..............',
    '..............',
  ];
  const s = 4;
  rows.forEach((row, j) => {
    [...row].forEach((ch, i) => { x.fillStyle = P[ch] || '#000'; x.fillRect(i * s, j * s, s, s); });
  });
}

/* ============ HUD ============ */
function updateHUD() {
  $('hp-fill').style.width = (100 * Player.hp / Player.maxHp) + '%';
  $('hp-text').textContent = `${Math.ceil(Player.hp)} / ${Player.maxHp}`;
  $('st-fill').style.width = (100 * Player.st / Player.maxSt) + '%';
  $('xp-fill').style.width = (100 * Player.xp / Player.xpNeed) + '%';
  $('player-level').textContent = 'LV ' + Player.level;
  $('level-badge').textContent = Player.level;
  $('flasks').textContent = `⚱ × ${Player.flasks}`;
  $('gold').textContent = `◈ ${Player.gold}`;
  $('q-stack').textContent = 'Q ' + (Player.qStack >= 2 ? '🌪️' : '○'.repeat(Math.max(0, 2 - Player.qStack)) + '●'.repeat(Player.qStack));
  $('flow-fill').style.width = Player.flow + '%';
  $('flow-fill').parentElement.classList.toggle('full', Player.flow >= 100);
  const cds = [['Q', 'ab-q'], ['W', 'ab-w'], ['E', 'ab-e'], ['R', 'ab-r'], ['F', 'ab-f']];
  const maxs = { Q: 4, W: 14, E: 6, R: 30, F: 1.2 };
  for (const [k, id] of cds) {
    const el = $(id);
    const cd = k === 'F' ? Player.cd.F : Player.cd[k];
    const pct = Math.max(0, cd / maxs[k]) * 100;
    el.querySelector('.cd').style.height = pct + '%';
    el.classList.toggle('oncd', cd > 0);
    el.classList.toggle('ready', cd <= 0);
  }
  if (Game.boss && Game.bossActive && !Game.boss.dead) {
    $('boss-fill').style.width = (100 * Game.boss.hp / Game.boss.maxHp) + '%';
    $('boss-ghost').style.width = (100 * Game.boss.hp / Game.boss.maxHp) + '%';
  }
  const cc = $('combo-counter');
  if (Player.comboHits >= 3 && Player.comboT > 0) {
    cc.classList.remove('hidden');
    cc.textContent = Player.comboHits + ' HITS!';
  } else cc.classList.add('hidden');
}
function drawMinimap() {
  const mm = $('minimap').getContext('2d');
  const S = 140, R = S / 2;
  mm.clearRect(0, 0, S, S);
  mm.fillStyle = 'rgba(6,12,20,0.9)';
  mm.beginPath(); mm.arc(R, R, R - 2, 0, 7); mm.fill();
  const scale = (R - 6) / 60;
  const dot = (x, z, c, s = 3) => {
    let dx = (x - Player.x) * scale, dz = (z - Player.z) * scale;
    const d = Math.hypot(dx, dz);
    if (d > R - 8) { dx *= (R - 8) / d; dz *= (R - 8) / d; }
    mm.fillStyle = c;
    mm.fillRect(R + dx - s / 2, R + dz - s / 2, s, s);
  };
  // arena + shrines
  dot(ARENA.x, ARENA.z, '#ff4444', 5);
  for (const s of shrines) dot(s.x, s.z, '#7fd4ff', 4);
  for (const e of Game.enemies) if (!e.dead) dot(e.x, e.z, '#ffaa33', 2);
  if (Game.boss && !Game.boss.dead) dot(Game.boss.x, Game.boss.z, '#ff2222', 5);
  // player arrow
  mm.save();
  mm.translate(R, R); mm.rotate(Math.atan2(Math.sin(Player.yaw), Math.cos(Player.yaw)) * -1 + Math.PI);
  mm.fillStyle = '#ffe9a8';
  mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 4); mm.lineTo(-4, 4); mm.closePath(); mm.fill();
  mm.restore();
}

/* ============ COLLISION ============ */
function collide(x, z, radius = 0.7) {
  for (const c of colliders) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r + radius && d > 0.001) {
      const push = (c.r + radius - d);
      x += (x - c.x) / d * push; z += (z - c.z) / d * push;
    }
  }
  const d = Math.hypot(x, z + 20);
  if (d > WORLD_R) { x *= WORLD_R / d; z = (z + 20) * WORLD_R / d - 20; }
  return { x, z };
}

/* ============ UPDATE: PLAYER ============ */
function updatePlayer(dt) {
  if (Player.dead) return;
  Player.animT += dt;
  // timers
  Player.iframes = Math.max(0, Player.iframes - dt);
  Player.comboWin -= dt; Player.comboT -= dt;
  if (Player.comboWin <= 0 && Player.atkT <= 0) Player.combo = 0;
  if (Player.comboT <= 0) Player.comboHits = 0;
  for (const k of ['Q', 'W', 'E', 'R', 'F']) Player.cd[k] = Math.max(0, Player.cd[k] - dt);
  Player.  qStackT -= dt; if (Player.qStackT <= 0) Player.qStack = 0;
  for (const k of ['hurtT', 'crouchT', 'spinT', 'whiffT']) if (Player[k] > 0) Player[k] -= dt;
  // Flow (Way of the Wanderer): movement charges the wind
  if (Player.moving || Player.eDashT > 0 || Player.rollT > 0) Player.flow = Math.min(100, Player.flow + (Player.sprinting ? 13 : 7) * dt);
  else Player.flow = Math.max(0, Player.flow - 2.5 * dt);
  if (Player.flow >= 100 && Math.random() < dt * 8) {
    Particles.spawn(Player.x, Player.y + 1.4, Player.z, 1, 0xbfe9ff, 2, 2);
  }
  if (Player.flaskT > 0) {
    Player.flaskT -= dt;
    Player.hp = Math.min(Player.maxHp, Player.hp + 25 * dt);
  }
  // camera input
  Game.camYaw -= Input.mouseDX * 0.0042 * (Input.sens || 1);
  Game.camPitch += Input.mouseDY * 0.0032 * (Input.sens || 1);
  Game.camPitch = Math.max(-0.5, Math.min(1.1, Game.camPitch));
  Input.mouseDX = 0; Input.mouseDY = 0;
  if (Input.pressed('ArrowLeft')) Game.camYaw += 2.2 * dt;
  if (Input.pressed('ArrowRight')) Game.camYaw -= 2.2 * dt;
  if (Input.pressed('ArrowUp')) Game.camPitch = Math.max(-0.5, Game.camPitch - 1.4 * dt);
  if (Input.pressed('ArrowDown')) Game.camPitch = Math.min(1.1, Game.camPitch + 1.4 * dt);

  // ULT sequence
  if (Player.ultT > 0) {
    Player.ultT -= dt; Player.ultTick += dt;
    const t = Player.ultTarget;
    if (t && !t.dead) {
      const k = 1 - Player.ultT / 1.6;
      Player.x = t.x + Math.sin(k * 12) * 1.6;
      Player.z = t.z + Math.cos(k * 12) * 1.6;
      Player.y = t.y + 1 + Math.sin(k * Math.PI) * 2.5;
      Player.yaw = Math.atan2(t.x - Player.x, t.z - Player.z);
      if (Player.ultTick > 0.28) {
        Player.ultTick = 0;
        hurtEnemy(t, 9 + Player.atk * 0.8, { stagger: 0.1, color: 0xcfefff });
        AudioSys.swing();
        AudioSys.tone(1500, 0.08, 'square', 0.05); // metallic impact ring
        Particles.slash(Player.x, Player.y + 1.4, Player.z, Player.yaw + Math.random());
        Particles.spawn(Player.x, Player.y + 1.6, Player.z, 6, 0xffe9a8, 6, 3); // sparks
      }
      t.airT = Math.max(t.airT, 0.4);
    }
    if (Player.ultT <= 0) {
      if (t && !t.dead) {
        hurtEnemy(t, 25 + Player.atk, { knockback: 4, big: true, color: 0xffe9a8 });
        t.airT = 0;
      }
      Player.y = groundH(Player.x, Player.z);
      Game.shake = 0.7;
      AudioSys.heavyHit();
      // controlled swordsman landing: crouch + final sweep ring
      Player.crouchT = 0.6;
      Player.lastAction = Game.time;
      Game.camKick = Math.max(Game.camKick, 1.5);
      rings.push({ mesh: ringMesh(Player.x, Player.y + 0.6, Player.z, 0xffe9a8, 1.5), t: 0 });
    }
    updateHUD();
    return;
  }

  // movement input (camera-relative)
  let ix = 0, iz = 0;
  if (Input.pressed('KeyW')) iz += 1;
  if (Input.pressed('KeyS')) iz -= 1;
  if (Input.pressed('KeyA')) ix -= 1;
  if (Input.pressed('KeyD')) ix += 1;
  const hasMove = (ix !== 0 || iz !== 0);
  Player.moving = hasMove;
  Player.sprinting = Input.pressed('ShiftLeft') || Input.pressed('ShiftRight');
  const speed = Player.sprinting && hasMove && Player.st > 1 ? 9.2 : 5.6;
  if (Player.sprinting && hasMove) Player.st = Math.max(0, Player.st - 10 * dt);
  else Player.st = Math.min(Player.maxSt, Player.st + 16 * dt);

  if (hasMove && Player.rollT <= 0 && Player.eDashT <= 0 && Player.atkT <= 0) {
    const len = Math.hypot(ix, iz); ix /= len; iz /= len;
    const sin = Math.sin(Game.camYaw), cos = Math.cos(Game.camYaw);
    // camera behind player: forward = away from camera
    const wx = (ix * cos - iz * sin), wz = (-ix * sin - iz * cos) * -1;
    const fx = -Math.sin(Game.camYaw), fz = -Math.cos(Game.camYaw);
    const rx = -Math.cos(Game.camYaw), rz = Math.sin(Game.camYaw);
    const mx = rx * ix + fx * iz, mz = rz * ix + fz * iz;
    Player.vx = mx * speed; Player.vz = mz * speed;
    Player.yaw = Math.atan2(mx, mz);
  } else if (Player.rollT <= 0 && Player.eDashT <= 0) {
    Player.vx *= 1 - Math.min(1, 10 * dt); Player.vz *= 1 - Math.min(1, 10 * dt);
  }

  // dodge roll (V / Alt / Control)
  const wantRoll = Input.pressed('KeyV') || Input.pressed('AltLeft') || Input.pressed('ControlLeft');
  if (wantRoll && !Player._rollHeld && Player.rollT <= 0 && Player.st >= 20) {
    Player._rollHeld = true;
    Player.st -= 20; Player.rollT = 0.45;
    Player.atkT = 0;
    const a = hasMove ? Player.yaw : Game.camYaw + Math.PI;
    Player.rollDX = Math.sin(a); Player.rollDZ = Math.cos(a);
    AudioSys.dash();
    Particles.spawn(Player.x, Player.y + 0.5, Player.z, 8, 0xcccccc, 3, 2);
  }
  if (!wantRoll) Player._rollHeld = false;
  if (Player.rollT > 0) {
    Player.rollT -= dt;
    Player.vx = Player.rollDX * 11; Player.vz = Player.rollDZ * 11;
  }
  // E dash
  if (Player.eDashT > 0) {
    Player.eDashT -= dt;
    // curved flowing dash: arc around the target
    const ep = 1 - Player.eDashT / 0.28;
    const bend = Math.sin(ep * Math.PI) * 9 * (Player.eSide || 1);
    Player.vx = Player.eDX * 22 - Player.eDZ * bend;
    Player.vz = Player.eDZ * 22 + Player.eDX * bend;
    Particles.spawn(Player.x, Player.y + 1, Player.z, 2, 0xcfefff, 2, 1);
    const targets = [...Game.enemies, ...(Game.boss && !Game.boss.dead ? [Game.boss] : [])];
    let resisted = false;
    for (const e of targets) {
      if (e.dead || Player.eHit.has(e)) continue;
      if (dist2(Player.x, Player.z, e.x, e.z) < 2.2) {
        Player.eHit.add(e);
        if ((e.noE || 0) > Game.time) { resisted = true; continue; } // storm-marked: no repeat dash
        e.noE = Game.time + 5;
        hurtEnemy(e, 10 + Player.atk, { stagger: 0.3 });
      }
    }
    if (resisted && !Player._resistToast) {
      Player._resistToast = true;
      Game.toast('⛔ Storm-marked — that foe resists your dash!');
      setTimeout(() => { Player._resistToast = false; }, 3000);
    }
  }
  // attacks
  if ((Input.mouseDown && !Player._mHeld) || Input.pressed('KeyJ') && !Player._jHeld) {
    Player._mHeld = Input.mouseDown; Player._jHeld = Input.pressed('KeyJ');
    tryLight();
  }
  if (!Input.mouseDown) Player._mHeld = false;
  if (!Input.pressed('KeyJ')) Player._jHeld = false;

  // heavy / charged
  if (Input.rDown || Input.pressed('KeyK')) Game.chargeHeld += dt;
  else {
    if (Game.chargeHeld > 0.08) tryHeavy(Game.chargeHeld > 0.5);
    Game.chargeHeld = 0;
  }
  if (Input.pressed('KeyQ') && !Player._qHeld) { Player._qHeld = true; castQ(); }
  if (!Input.pressed('KeyQ')) Player._qHeld = false;
  if (Input.pressed('KeyC') && !Player._cHeld) { Player._cHeld = true; castW(); }
  if (!Input.pressed('KeyC')) Player._cHeld = false;
  if (Input.pressed('KeyE') && !Player._eHeld) { Player._eHeld = true; tryInteractOrDash(); }
  if (!Input.pressed('KeyE')) Player._eHeld = false;
  if (Input.pressed('KeyR') && !Player._rHeld) { Player._rHeld = true; castR(); }
  if (!Input.pressed('KeyR')) Player._rHeld = false;
  if (Input.pressed('KeyF') && !Player._fHeld) { Player._fHeld = true; drinkFlask(); }
  if (!Input.pressed('KeyF')) Player._fHeld = false;
  if (Input.pressed('Space') && Player.grounded && Player.rollT <= 0) {
    Player.vy = 8; Player.grounded = false; AudioSys.dash();
  }

  // attack hit resolution (mid-swing)
  if (Player.atkT > 0) {
    Player.atkT -= dt;
    Player.animT += dt * 2;
    const total = Player.atkKind === 'charged' ? 0.8 : Player.atkKind === 'heavy' ? 0.55 : 0.42;
    const phase = 1 - Player.atkT / total;
    if (!Player.didHitP && phase > 0.35) {
      Player.didHitP = true;
      if (Player.atkKind === 'light1') meleeArc(12 + Player.atk, 3.2, 2.4, { stagger: 0.2 });
      else if (Player.atkKind === 'light2') meleeArc(13 + Player.atk, 3.2, 2.4, { stagger: 0.25 });
      else if (Player.atkKind === 'light3') meleeArc(18 + Player.atk, 3.6, 2.6, { knockback: 2.5, stagger: 0.4 });
      else if (Player.atkKind === 'heavy') {
        if (!meleeArc(26 + Player.atk * 1.2, 3.8, 2.8, { knockback: 3, stagger: 0.5 })) Player.whiffT = 1.6;
      }
      else if (Player.atkKind === 'charged') {
        Game.camKick = Math.max(Game.camKick, 1.5);
        if (!meleeArc(45 + Player.atk * 1.6, 4.4, 3.4, { knockback: 5, knockup: 1.2, big: true, color: 0xcfefff })) Player.whiffT = 1.6;
        AudioSys.tornado(); Game.shake = Math.max(Game.shake, 0.45);
      }
    }
    // slight forward lunge during swings (not while drawing)
    if (Player.atkKind !== 'draw' && Player.atkKind !== 'wcast') {
      Player.vx = Math.sin(Player.yaw) * 3.2; Player.vz = Math.cos(Player.yaw) * 3.2;
    }
  }

  // integrate
  let nx = Player.x + Player.vx * dt, nz = Player.z + Player.vz * dt;
  const c = collide(nx, nz, 0.7);
  Player.x = c.x; Player.z = c.z;
  const gh = groundH(Player.x, Player.z);
  if (!Player.grounded || Player.vy !== 0) {
    Player.vy -= 24 * dt;
    Player.y += Player.vy * dt;
    if (Player.y <= gh) { Player.y = gh; Player.vy = 0; Player.grounded = true; }
  } else Player.y = gh;

  // pickups
  for (const p of pickups) {
    if (p.taken) continue;
    if (dist2(Player.x, Player.z, p.x, p.z) < 1.6) {
      p.taken = true; p.mesh.visible = false;
      if (p.type === 'spirit') { Player.hp = Math.min(Player.maxHp, Player.hp + 18); Game.toast('✨ Spirit orb (+18 HP)'); AudioSys.drink(); }
      else if (p.type === 'gold') { Player.gold += p.amount; Game.toast(`◈ +${p.amount} gold`); AudioSys.tone(880, 0.15, 'sine', 0.08); }
      else if (p.type === 'flask') { Player.flasks = Math.min(Player.maxFlasks, Player.flasks + 1); Game.toast('⚱ Flask restored'); AudioSys.drink(); }
      else if (p.type === 'blade') {
        Player.atk += 4; Game.toast('🗡️ WINDBOUND SHARD found! +4 ATK (permanent)');
        Game.subtitle('An ancient blade shard hums with stormlight. Your edge grows heavier.');
        AudioSys.levelup();
      }
      Game.save();
    }
  }
  // lore stones
  for (const l of loreStones) {
    if (dist2(Player.x, Player.z, l.x, l.z) < 3 && (!l.cd || Game.time > l.cd)) {
      l.cd = Game.time + 14;
      Game.subtitle('📜 ' + l.text, 5);
      AudioSys.tone(520, 0.4, 'sine', 0.06);
    }
  }
  // NPC monk
  for (const n of npcs) {
    if (dist2(Player.x, Player.z, n.x, n.z) < 4 && Game.time > (n.cd || 0)) {
      n.cd = Game.time + 16;
      Game.subtitle('🧘 Elder Souma: “' + n.lines[n.idx % n.lines.length] + '”', 5.5);
      n.idx++;
    }
  }
  // sealed portals (expandable teaser)
  for (const p of portals) {
    if (dist2(Player.x, Player.z, p.x, p.z) < 4 && Game.time > (p.cd || 0)) {
      p.cd = Game.time + 20;
      Game.subtitle(`⛩️ ${p.info.name} — “This shadow is still sealed. Fell Yone to stir the others… (coming soon)”`, 5);
    }
  }
  // shrine interaction
  Game.interactTarget = null;
  for (const s of shrines) {
    if (dist2(Player.x, Player.z, s.x, s.z) < 5) Game.interactTarget = s;
  }
  $('interact-prompt').classList.toggle('hidden', !Game.interactTarget);
  if (Game.interactTarget) $('interact-prompt').textContent = `[ E ] Rest at ${Game.interactTarget.name}`;

  // boss trigger
  const bd = dist2(Player.x, Player.z, ARENA.x, ARENA.z);
  if (!Game.bossIntroDone && !Game.bossDefeated && bd < ARENA.r + 2 && Game.boss && !Game.boss.dead) {
    startBossIntro(Game.boss);
  }
  // location label
  const loc = bd < ARENA.r + 12 ? '⚔ YONE\'S DUEL RING' :
    dist2(Player.x, Player.z, -70, -40) < 30 ? 'SUNKEN VILLAGE' :
    dist2(Player.x, Player.z, 60, -70) < 34 ? 'FORGOTTEN TEMPLE' :
    dist2(Player.x, Player.z, 93, 5) < 18 ? 'HOWLING CAVES' : 'FORGOTTEN IONIA';
  $('location-name').textContent = loc;
  updateHUD();
}

function tryInteractOrDash() {
  if (Game.interactTarget) {
    const s = Game.interactTarget;
    Player.shrineIdx = s.idx;
    Player.hp = Player.maxHp; Player.st = Player.maxSt;
    Player.flasks = Player.maxFlasks;
    s.lit = true;
    if (s.flame) s.flame.material = MAT.lantern;
    if (s.light) s.light.intensity = 1.4;
    AudioSys.shrine();
    Particles.spawn(s.x, 4, s.z, 40, 0x7fd4ff, 4, 6);
    Game.subtitle(`⛩️ Rested at ${s.name}. Wounds closed. Flasks refilled. Progress saved.`);
    Game.toast(`⛩️ Soul anchored — ${s.name}`);
    Game.save();
    updateHUD();
    return;
  }
  castE();
}

/* ============ UPDATE: ENEMIES ============ */
function updateEnemy(e, dt) {
  const f = e.mesh;
  if (e.dead) {
    e.deathT = (e.deathT || 0) + dt;
    f.group.rotation.x = Math.min(Math.PI / 2, (e.deathT || 0) * 3);
    f.group.position.y = Math.max(e.y - 1.2, f.group.position.y - dt);
    if (e.deathT > 4) f.group.visible = false;
    return;
  }
  e.animT += dt;
  e.cool -= dt;
  e.stagger = Math.max(0, e.stagger - dt);
  // knockup physics
  if (e.airT > 0) {
    e.airT -= dt;
    e.vyAir = (e.vyAir ?? 6) - 20 * dt;
    e.y += e.vyAir * dt;
    const gh = groundH(e.x, e.z);
    if (e.y < gh) { e.y = gh; if (e.airT < 0.3) e.airT = 0; }
    f.group.position.set(e.x, e.y, e.z);
    f.group.rotation.x = -0.7;
    return;
  }
  f.group.rotation.x = 0;
  const dp = dist2(e.x, e.z, Player.x, Player.z);
  const staggered = e.stagger > 0;
  let mvx = 0, mvz = 0, wantAttack = false;

  if (!Player.dead && dp < 26 && !staggered) {
    if (e.type === 'archer' && dp < 20 && dp > 9) {
      // strafe + shoot
      const a = Math.atan2(Player.x - e.x, Player.z - e.z) + Math.PI / 2;
      mvx = Math.cos(a) * e.speed * 0.4; mvz = Math.sin(a) * e.speed * 0.4;
      e.yaw = Math.atan2(Player.x - e.x, Player.z - e.z);
      if (e.cool <= 0) { e.cool = 2.6 + Math.random(); wantAttack = 'shoot'; }
    } else if (dp > (e.type === 'brute' ? 2.4 : 1.9)) {
      const a = Math.atan2(Player.x - e.x, Player.z - e.z);
      e.yaw = a;
      const sp = e.speed * (dp > 14 ? 1.5 : 1);
      mvx = Math.sin(a) * sp; mvz = Math.cos(a) * sp;
      e.state = 'chase';
    } else {
      e.yaw = Math.atan2(Player.x - e.x, Player.z - e.z);
      e.state = 'attack';
      if (e.cool <= 0 && e.atkT <= 0) { wantAttack = 'swing'; }
    }
  } else if (staggered) {
    e.state = 'stagger';
  } else {
    // drift home / idle patrol
    e.state = 'idle';
    const dh = dist2(e.x, e.z, e.homeX, e.homeZ);
    if (dh > 3) {
      const a = Math.atan2(e.homeX - e.x, e.homeZ - e.z);
      mvx = Math.sin(a) * e.speed * 0.4; mvz = Math.cos(a) * e.speed * 0.4;
      e.yaw = a;
    }
  }
  if (wantAttack === 'swing') {
    e.atkT = e.type === 'brute' ? 0.9 : 0.6;
    e.atkMax = e.atkT; e.didHit = false; e.swingId++;
    AudioSys.swing();
  }
  if (wantAttack === 'shoot') {
    e.atkT = 0.5; e.atkMax = 0.5; e.didHit = false; e.shoot = true;
  }
  if (e.atkT > 0) {
    e.atkT -= dt;
    const ph = 1 - e.atkT / e.atkMax;
    if (!e.didHit && ph > 0.5) {
      e.didHit = true;
      if (e.shoot) {
        const a = Math.atan2(Player.x - e.x, Player.z - e.z);
        spawnProjectile(e.x, e.y + 1.5, e.z, Math.sin(a), Math.cos(a), 13, e.dmg, e, false, 0xff8844, 3);
        e.shoot = false;
      } else if (dp < (e.type === 'brute' ? 3.4 : 2.8)) {
        hurtPlayer(e.dmg, e.x, e.z, `Slain by ${e.label}.`);
      }
    }
    if (e.atkT <= 0) e.cool = (e.type === 'brute' ? 2.2 : 1.4) + Math.random();
  }
  if (e.atkT <= 0) {
    const c = collide(e.x + mvx * dt, e.z + mvz * dt, 0.6);
    e.x = c.x; e.z = c.z;
  }
  e.y = groundH(e.x, e.z);
  f.group.position.set(e.x, e.y, e.z);
  f.group.rotation.y = e.yaw;
  // procedural walk / attack animation
  const sw = Math.sin(e.animT * (e.state === 'chase' ? 9 : 3));
  f.legL.rotation.x = sw * 0.6; f.legR.rotation.x = -sw * 0.6;
  f.armL.rotation.x = -sw * 0.4;
  if (e.atkT > 0) f.armR.rotation.x = -2.2 + (1 - e.atkT / e.atkMax) * 2.6;
  else f.armR.rotation.x = sw * 0.4;
  if (staggered) f.group.rotation.z = Math.sin(Game.time * 30) * 0.08;
  else f.group.rotation.z = 0;
}

/* ============ UPDATE: BOSS (Yone) ============ */
function startBossIntro(b) {
  Game.bossIntroDone = true;
  Game.bossActive = true;
  b.state = 'intro'; b.introT = 4.0;
  AudioSys.bossRoar();
  AudioSys.intensity = 1;
  $('boss-bar-wrap').classList.remove('hidden');
  $('boss-fill').style.width = '100%'; $('boss-ghost').style.width = '100%';
  $('boss-phase-pips').textContent = '◆ ◆ ◆';
  const card = $('boss-intro-card');
  card.classList.remove('hidden');
  setTimeout(() => card.classList.add('hidden'), 4300);
  Game.subtitle('YONE: “Little brother… you chased the wind here, of all graves?”', 4.5);
  Game.lockTarget = b;
  Game.camKick = 3.5; // dramatic pullback for the entrance
  b.yaw = Math.atan2(Player.x - b.x, Player.z - b.z);
  Particles.spawn(b.x, b.y + 2, b.z, 80, 0x9fd8ff, 8, 8);
}
function updateBoss(b, dt) {
  const f = b.mesh;
  if (b.dead) {
    b.deathT = (b.deathT || 0) + dt;
    f.group.rotation.x = Math.min(Math.PI / 2.2, (b.deathT || 0) * 1.8);
    f.group.position.y = b.y - Math.min(1.4, (b.deathT || 0) * 0.5);
    if (Math.random() < 0.3) Particles.spawn(b.x, b.y + 1, b.z, 2, 0x9fd8ff, 3, 3);
    return;
  }
  b.animT += dt;
  b.cool -= dt;
  b.stagger = Math.max(0, b.stagger - dt);
  if (b.airT > 0) {
    b.airT -= dt;
    b.vyAir = (b.vyAir ?? 6) - 20 * dt;
    b.y += b.vyAir * dt;
    const gh = groundH(b.x, b.z);
    if (b.y < gh) { b.y = gh; if (b.airT < 0.3) b.airT = 0; }
    f.group.position.set(b.x, b.y, b.z);
    f.group.rotation.x = -0.7;
    return;
  }
  f.group.rotation.x = 0;
  if (b.state === 'dormant') {
    // kneeling vigil, spirit glow
    f.group.position.set(b.x, b.y, b.z);
    f.group.rotation.y = Math.sin(Game.time * 0.5) * 0.3 + Math.PI;
    f.armR.rotation.x = 0.4; f.armL.rotation.x = 0.4;
    if (Math.random() < dt * 3) Particles.spawn(b.x, b.y + 1, b.z, 1, 0x9fd8ff, 1, 2);
    return;
  }
  if (b.state === 'intro') {
    b.introT -= dt;
    b.yaw = Math.atan2(Player.x - b.x, Player.z - b.z);
    f.group.rotation.y = b.yaw;
    f.armR.rotation.x = -1.4; // blade raised
    if (b.introT <= 0) { b.state = 'chase'; b.cool = 1.2; Game.subtitle('⚔ SURVIVE. Learn. Punish. — Dodge THROUGH red telegraphs!', 5); }
    f.group.position.set(b.x, b.y, b.z);
    return;
  }
  const dp = dist2(b.x, b.z, Player.x, Player.z);
  const spdMul = b.phase === 3 ? 1.5 : b.phase === 2 ? 1.2 : 1;
  const staggered = b.stagger > 0.35;

  if (b.state === 'attack') {
    b.atkT += dt;
    const k = b.atkKind;
    const dur = k === 'combo' ? 1.5 : k === 'dash' ? 0.7 : k === 'slam' ? 1.6 : k === 'burst' ? 1.2 : 1.0;
    // dash movement
    if (k === 'dash' && b.atkT < 0.45) {
      const a = Math.atan2(Player.x - b.x, Player.z - b.z);
      b.yaw = a;
      const c = collide(b.x + Math.sin(a) * 26 * dt, b.z + Math.cos(a) * 26 * dt, 0.7);
      b.x = c.x; b.z = c.z;
      Particles.spawn(b.x, b.y + 1, b.z, 3, 0x9fd8ff, 3, 2);
      if (dp < 2.4 && !b.didHit) { b.didHit = true; hurtPlayer(b.dmg + 4, b.x, b.z, 'Impaled by Yone\'s spirit dash.'); }
    }
    // combo slashes: 3 hits
    if (k === 'combo') {
      const hits = [0.35, 0.75, 1.15];
      const idx = hits.findIndex(h => b.atkT >= h && b.lastHit < h);
      if (idx >= 0) {
        b.lastHit = hits[idx];
        AudioSys.swing();
        Particles.slash(b.x, b.y + 1.4, b.z, b.yaw);
        if (dp < 4.2) hurtPlayer(b.dmg * (idx === 2 ? 1.4 : 0.9), b.x, b.z, 'Cut down by Yone\'s combo.');
      }
    }
    if (k === 'burst' && !b.didHit && b.atkT > 0.6) {
      b.didHit = true;
      for (let i = -1; i <= 1; i++) {
        const a = Math.atan2(Player.x - b.x, Player.z - b.z) + i * 0.18;
        spawnProjectile(b.x, b.y + 1.6, b.z, Math.sin(a), Math.cos(a), 16, b.dmg * 0.7, b, false, 0x9fd8ff, 3);
      }
      AudioSys.swing();
    }
    if (k === 'slam' && !b.didHit && b.atkT > 0.9) {
      b.didHit = true;
      spawnTelegraph(b.x, b.z, 7, 0.55, b.dmg * 1.8, b);
      Game.shake = 0.6; AudioSys.heavyHit();
    }
    if (k === 'ult' && !b.didHit && b.atkT > 0.5) {
      b.didHit = true;
      // spirit prison: cross slashes around player position snapshot
      spawnTelegraph(b.snapX, b.snapZ, 5, 0.7, b.dmg * 1.5, b);
      AudioSys.bossRoar();
    }
    if (b.atkT >= dur) {
      b.state = 'chase';
      b.cool = (b.phase === 3 ? 0.7 : b.phase === 2 ? 1.1 : 1.6) + Math.random() * 0.8;
      if (b.phase >= 2 && b.atkKind === 'slam' && Math.random() < 0.45) b.cool = 0.15; // sunder straight into a dash
    }
  } else if (!staggered && !Player.dead) {
    // choose attack
    // punish mistakes: a whiffed heavy invites Yone's iaito dash
    if (b.cool <= 0 && Player.whiffT > 0 && dp > 5 && dp < 19 && b.state !== 'attack') {
      bossStartAttack(b, 'dash'); b.lastHit = -1;
      b.cool = 1.2;
    } else if (b.cool <= 0) {
      const opts = ['combo', 'dash'];
      if (b.phase >= 2) opts.push('burst', 'slam');
      if (b.phase >= 3) opts.push('ult', 'slam');
      if (dp > 12) { bossStartAttack(b, Math.random() < 0.6 ? 'dash' : 'burst'); }
      else if (dp > 6 && Math.random() < 0.4) bossStartAttack(b, 'dash');
      else {
        const pick = opts[Math.floor(Math.random() * opts.length)];
        if (pick === 'ult') { b.snapX = Player.x; b.snapZ = Player.z; }
        if (pick === 'slam' && dp > 8) { // close gap first with telegraph at player
          b.snapX = Player.x; b.snapZ = Player.z;
          spawnTelegraph(Player.x, Player.z, 5.5, 0.9, b.dmg * 1.4, b);
          AudioSys.bossRoar();
          b.cool = 1.5; b.state = 'chase';
        } else { bossStartAttack(b, pick); b.lastHit = -1; }
      }
    } else {
      // stalk player
      const a = Math.atan2(Player.x - b.x, Player.z - b.z);
      b.yaw = a;
      if (dp > 2.6) {
        const s = b.speed * spdMul;
        const c = collide(b.x + Math.sin(a) * s * dt, b.z + Math.cos(a) * s * dt, 0.7);
        b.x = c.x; b.z = c.z;
      }
    }
  }
  b.y = groundH(b.x, b.z);
  f.group.position.set(b.x, b.y, b.z);
  f.group.rotation.y = b.yaw;
  // animation
  const attacking = b.state === 'attack';
  const sw = Math.sin(b.animT * (attacking ? 14 : 6));
  f.legL.rotation.x = sw * 0.7; f.legR.rotation.x = -sw * 0.7;
  if (attacking) { f.armR.rotation.x = -2.4 + b.atkT * 3.2; f.armL.rotation.x = -2.0 + b.atkT * 2.4; }
  else { f.armR.rotation.x = sw * 0.3 - 0.3; f.armL.rotation.x = -sw * 0.3 - 0.3; }
  if (staggered) f.group.rotation.z = 0.1; else f.group.rotation.z = 0;
}

/* ============ UPDATE: PROJECTILES / WALLS / TELEGRAPHS / PICKUPS ============ */
function updateShots(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const s = projectiles[i];
    s.life -= dt;
    s.x += s.vx * dt; s.z += s.vz * dt;
    if (s.tornado) {
      s.spin += dt * 12;
      s.mesh.rotation.y += dt * 10;
      s.mesh.position.set(s.x, s.y + Math.sin(Game.time * 8) * 0.2, s.z);
      s.mesh.scale.setScalar(1 + s.spin * 0.03);
      // damage ticks
      const targets = [...Game.enemies, ...(Game.boss && !Game.boss.dead ? [Game.boss] : [])];
      for (const e of targets) {
        if (e.dead || (s.hitSet?.has(e))) continue;
        if (dist2(s.x, s.z, e.x, e.z) < 2.2) {
          (s.hitSet ??= new Set()).add(e);
          hurtEnemy(e, s.dmg, { knockup: 1.6, big: true, color: 0xcfefff });
          AudioSys.tornado();
        }
      }
      if (Math.random() < 0.6) {
        const cols = [0xcfefff, 0x4f9a44, 0x8a6a3a, 0xe09ac0]; // air, leaves, dust, petals
        Particles.spawn(s.x, s.y, s.z, 2, cols[Math.floor(Math.random() * cols.length)], 4, 3);
      }
    } else {
      s.mesh.position.set(s.x, s.y, s.z);
      // wind wall block (enemy projectiles only)
      if (!s.friendly) {
        let blocked = false;
        for (const w of walls) {
          const lx = s.x - w.x, lz = s.z - w.z;
          const along = lx * Math.cos(w.yaw) + lz * Math.sin(w.yaw);
          const perp = -lx * Math.sin(w.yaw) + lz * Math.cos(w.yaw);
          if (Math.abs(along) < w.w / 2 && Math.abs(perp) < 1.2) { blocked = true; break; }
        }
        if (blocked) {
          Particles.spawn(s.x, s.y, s.z, 8, 0xbfe9ff, 3, 2);
          scene.remove(s.mesh); projectiles.splice(i, 1); continue;
        }
        if (dist2(s.x, s.z, Player.x, Player.z) < 1.1 && Math.abs(s.y - (Player.y + 1.2)) < 1.6) {
          hurtPlayer(s.dmg, s.x - s.vx, s.z - s.vz, 'Pierced by spirit steel.');
          scene.remove(s.mesh); projectiles.splice(i, 1); continue;
        }
      } else {
        // friendly bolt hits enemies
        const targets = [...Game.enemies, ...(Game.boss && !Game.boss.dead ? [Game.boss] : [])];
        for (const e of targets) {
          if (e.dead) continue;
          if (dist2(s.x, s.z, e.x, e.z) < 1.2 && Math.abs(s.y - (e.y + 1.2)) < 1.8) {
            hurtEnemy(e, s.dmg, { stagger: 0.15 });
            scene.remove(s.mesh); projectiles.splice(i, 1); s.life = -1;
            break;
          }
        }
        if (s.life < 0) continue;
      }
    }
    if (s.life <= 0) { scene.remove(s.mesh); projectiles.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt * 1.8;
    r.mesh.scale.setScalar(1 + r.t * 4);
    r.mesh.material.opacity = Math.max(0, 0.7 * (1 - r.t));
    if (r.t >= 1) { scene.remove(r.mesh); rings.splice(i, 1); }
  }
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    w.life -= dt;
    w.mesh.material.opacity = Math.min(0.45, w.life * 0.3);
    if (w.life <= 0) { scene.remove(w.mesh); walls.splice(i, 1); }
  }
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const t = telegraphs[i];
    t.t += dt;
    const k = t.t / t.delay;
    t.mesh.scale.setScalar(0.3 + 0.7 * Math.min(1, k));
    t.mesh.material.opacity = 0.3 + 0.4 * Math.min(1, k);
    if (t.t >= t.delay) {
      // detonate
      Particles.spawn(t.x, groundH(t.x, t.z) + 1, t.z, 30, 0xff4422, 9, 6);
      AudioSys.heavyHit();
      Game.shake = Math.max(Game.shake, 0.5);
      if (dist2(Player.x, Player.z, t.x, t.z) < t.r) {
        hurtPlayer(t.dmg, t.x, t.z, 'Consumed by Yone\'s spirit prison.');
      }
      scene.remove(t.mesh); telegraphs.splice(i, 1);
    }
  }
  for (const p of pickups) {
    if (p.taken) continue;
    p.bob += dt * 2;
    p.mesh.rotation.y += dt * 2;
    p.mesh.position.y = groundH(p.x, p.z) + 0.9 + Math.sin(p.bob) * 0.2;
  }
}

/* ============ PLAYER MESH + CAMERA ============ */
let playerRig = null;
function buildPlayerMesh() {
  playerRig = makeHero({});
  scene.add(playerRig.group);
}
function animateFighter(rig, opts) {
  const { running, attacking, kind, phase, rolling, ult, armed = true, crouch = false, hurt = false, spin = false, wcast = false } = opts;
  const t = Game.time * (running ? 11 : 3.5);
  const sw = Math.sin(t);
  const hero = !!rig.cape;
  rig.group.rotation.x = 0; rig.group.rotation.z = 0;
  rig.torso.rotation.set(0, 0, 0);
  rig.torso.scale.y = 1 + Math.sin(Game.time * 2.2) * 0.02; // breathing
  if (rolling || crouch) {
    // low footwork slide (no tuck-roll): front leg extends, torso leans in
    rig.legL.rotation.x = -1.05; rig.legR.rotation.x = 0.75;
    rig.torso.rotation.x = 0.5;
    rig.armL.rotation.x = -0.6; rig.armR.rotation.x = -0.9;
  } else if (ult) {
    rig.legL.rotation.x = 0.5; rig.legR.rotation.x = -0.4;
    rig.armR.rotation.x = -2.6 + Math.sin(Game.time * 30) * 0.9;
    rig.armL.rotation.x = -2.2 - Math.sin(Game.time * 30) * 0.9;
    rig.group.rotation.z = Math.sin(Game.time * 20) * 0.25;
  } else if (attacking) {
    const p = phase;
    if (kind === 'draw') {
      rig.armR.rotation.x = 0.3 - p * 1.9; // fast deliberate draw upward
      rig.armL.rotation.x = -0.2;
      rig.legL.rotation.x = 0.15; rig.legR.rotation.x = -0.15;
      rig.torso.rotation.y = p * 0.4;
    } else if (kind === 'q' || kind === 'qspin') {
      if (kind === 'qspin' || spin) {
        rig.torso.rotation.y = p * Math.PI * 2; // full spinning strike
        rig.armR.rotation.set(-1.5, 0, 1.2);
        rig.armL.rotation.set(-1.5, 0, -1.2);
      } else {
        // planted-foot, hip-rotated thrust
        rig.armR.rotation.x = -1.55;
        rig.torso.rotation.y = Math.sin(p * Math.PI) * 0.55;
        rig.legL.rotation.x = 0.5; rig.legR.rotation.x = -0.5;
        rig.armL.rotation.x = 0.5;
      }
    } else if (kind === 'wcast' || wcast) {
      rig.armR.rotation.z = -1.5 + p * 3.0; // horizontal wind-wall sweep
      rig.armR.rotation.x = -1.2;
      rig.torso.rotation.y = -0.4 + p * 0.8;
      rig.armL.rotation.x = 0.4;
    } else if (kind && kind.startsWith('light')) {
      const n = kind === 'light1' ? 0 : kind === 'light2' ? 1 : 2;
      rig.armR.rotation.x = -2.2 + p * 3.0;
      rig.armR.rotation.z = (n - 1) * 0.7 * Math.sin(p * Math.PI);
      rig.torso.rotation.y = Math.sin(p * Math.PI) * (n === 2 ? 0.9 : 0.5) * (n === 1 ? -1 : 1);
      rig.armL.rotation.x = 0.5 - p * 0.6;
      rig.legL.rotation.x = sw * 0.3 + 0.2; rig.legR.rotation.x = -sw * 0.3 - 0.2;
    } else { // heavy / charged: deliberate wind-up, powerful follow-through
      rig.armR.rotation.x = -2.9 + p * 4.4;
      rig.armL.rotation.x = -1.4 + p * 1.8;
      rig.torso.rotation.y = Math.sin(p * Math.PI) * 0.9;
      rig.torso.rotation.x = (1 - p) * -0.35 + 0.25;
      rig.legL.rotation.x = -0.5; rig.legR.rotation.x = 0.5;
    }
  } else {
    rig.legL.rotation.x = sw * (running ? 0.9 : 0.12);
    rig.legR.rotation.x = -sw * (running ? 0.9 : 0.12);
    if (hero && !armed) {
      // calm wanderer: hand near sheathed sword, relaxed
      rig.armR.rotation.x = -0.25 + sw * 0.05;
      rig.armL.rotation.x = -0.15 - sw * 0.05;
      rig.torso.rotation.y = Math.sin(Game.time * 0.9) * 0.04;
    } else {
      // combat-ready swordsman lean
      rig.armR.rotation.x = -0.75 + sw * 0.1;
      rig.armL.rotation.x = -0.35 - sw * 0.08;
      rig.torso.rotation.x = running ? 0.18 : 0.05;
    }
  }
  if (hurt) { rig.torso.rotation.x = -0.35; rig.armL.rotation.x = -1.2; }
  // secondary motion: cloth + hair react to movement
  const flow = running ? 0.6 : 0.12;
  if (hero) {
    rig.cape.rotation.x = flow + Math.sin(Game.time * 3) * 0.07;
    rig.ponytail.rotation.x = flow * 0.7 + Math.sin(Game.time * 4.2) * 0.09;
    rig.bandTails.rotation.x = flow * 0.5 + Math.sin(Game.time * 5) * 0.12;
    rig.swordPivot.visible = armed || attacking;
    if (rig.sheath) rig.sheath.visible = !(armed || attacking);
  } else {
    rig.ponytail.rotation.x = running ? 0.9 : 0.3 + Math.sin(Game.time * 2) * 0.1;
  }
}
function updateCamera(dt) {
  let tx = Player.x, ty = Player.y + 2.2, tz = Player.z;
  if (Game.lockTarget && !Game.lockTarget.dead) {
    const t = Game.lockTarget;
    // frame both: midpoint bias
    tx = (Player.x + t.x) / 2; tz = (Player.z + t.z) / 2;
    Game.camYaw = lerpAngle(Game.camYaw, Math.atan2(Player.x - t.x, Player.z - t.z), 1 - Math.pow(0.001, dt));
  }
  const cp = Game.camPitch;
  const dirX = Math.sin(Game.camYaw) * Math.cos(cp);
  const dirZ = Math.cos(Game.camYaw) * Math.cos(cp);
  const dirY = Math.sin(cp);
  // collision-aware boom: shorten when pillars / terrain block the view
  const boomBase = Game.camDist + (Game.camKick || 0);
  let dist = boomBase;
  const STEPS = 12;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const sx = tx + dirX * boomBase * t;
    const sy = ty + dirY * boomBase * t;
    const sz = tz + dirZ * boomBase * t;
    let blocked = sy < groundH(sx, sz) + 0.5;
    if (!blocked) {
      for (const c of colliders) {
        const dx = sx - c.x, dz = sz - c.z;
        if (dx * dx + dz * dz < (c.r + 0.5) * (c.r + 0.5) && sy < groundH(c.x, c.z) + 6) { blocked = true; break; }
      }
    }
    if (blocked) { dist = Math.max(2.0, boomBase * (i - 1) / STEPS - 0.4); break; }
  }
  Game.camDistS = Game.camDistS == null ? dist : Game.camDistS + (dist - Game.camDistS) * Math.min(1, 12 * dt);
  const cx = tx + dirX * Game.camDistS;
  const cz = tz + dirZ * Game.camDistS;
  let cy = ty + dirY * Game.camDistS;
  const minY = groundH(cx, cz) + 0.6;
  if (cy < minY) cy = minY;
  Game.shake = Math.max(0, Game.shake - dt * 2.2);
  const sh = Game.shake * Game.shake;
  camera.position.set(
    cx + (Math.random() - 0.5) * sh * 1.4,
    cy + (Math.random() - 0.5) * sh * 1.2,
    cz + (Math.random() - 0.5) * sh * 1.4
  );
  camera.lookAt(tx, ty, tz);
  warm.position.set(Player.x + 2, Player.y + 4, Player.z + 2);
  // moon follows for stable shadows
  moon.position.set(Player.x + 90, 42, Player.z - 30);
  moon.target.position.set(Player.x, 0, Player.z);
  moon.target.updateMatrixWorld();
}
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

/* ============ BOOT / LOOP ============ */
function applySave(s) {
  if (!s) return false;
  Player.level = s.level || 1; Player.xp = s.xp || 0; Player.gold = s.gold || 0;
  Player.atk = s.atk || 10; Player.maxHp = s.maxHp || 100; Player.hp = Player.maxHp;
  Player.blade = s.blade || 'WEATHERED KATANA';
  Player.shrineIdx = s.shrine ?? 0;
  Game.bossDefeated = !!s.bossDefeated;
  const sh = shrines[Player.shrineIdx] || shrines[0];
  Player.x = sh.x + 3; Player.z = sh.z + 3;
  return true;
}

let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const rdt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  Game.slowT = Math.max(0, (Game.slowT || 0) - rdt);
  Game.camKick = Math.max(0, (Game.camKick || 0) - rdt * 5);
  const dt = (Game.state === 'playing' && !Game.paused && Game.slowT > 0) ? rdt * 0.28 : rdt;
  if (Game.state !== 'playing' || Game.paused) {
    // idle camera drift on title
    if (Game.state === 'title') {
      const t = now / 1000;
      camera.position.set(Math.sin(t * 0.1) * 30, groundH(0, -40) + 12, -40 + Math.cos(t * 0.1) * 30);
      camera.lookAt(0, groundH(0, -60) + 4, -60);
      Particles.update(dt || 0.016, 0, -40);
    }
    renderer.render(scene, camera);
    return;
  }
  Game.time += dt;
  AudioSys.music(dt);
  AudioSys.intensity = Game.bossActive && Game.boss && !Game.boss.dead ? 1 : 0.25;
  updatePlayer(dt);
  for (const e of Game.enemies) updateEnemy(e, dt);
  if (Game.boss) updateBoss(Game.boss, dt);
  updateShots(dt);
  for (const f of falls) f.tex.offset.y -= dt * 1.4; // scrolling foam
  Game.mistT -= dt;
  if (Game.mistT <= 0) {
    Game.mistT = 0.25;
    for (const f of falls) {
      if (f.x === undefined || dist2(Player.x, Player.z, f.x, f.z) > 60) continue;
      Particles.spawn(f.x + (Math.random() - 0.5) * 4, groundH(f.x, f.z) + 0.5, f.z, 2, 0xcfefff, 2, 2);
    }
  }
  Particles.update(dt, Player.x, Player.z);
  // player mesh
  playerRig.group.position.set(Player.x, Player.y, Player.z);
  playerRig.group.rotation.y = Player.yaw;
  const ATK_DUR = { charged: 0.8, heavy: 0.55, draw: 0.25, q: 0.35, wcast: 0.4 };
  const atkTotal = ATK_DUR[Player.atkKind] || 0.42;
  const armed = Game.time - Player.lastAction < 3.5 || Player.atkT > 0 || Player.eDashT > 0 || Player.ultT > 0;
  if (armed && !Player.wasArmed && Player.atkT <= 0) {
    Player.atkT = 0.25; Player.atkKind = 'draw'; Player.animT = 0; Player.didHitP = true;
    AudioSys.swing();
  }
  Player.wasArmed = armed;
  animateFighter(playerRig, {
    running: Player.moving && Player.grounded,
    attacking: Player.atkT > 0,
    kind: Player.atkKind,
    phase: Player.atkT > 0 ? 1 - Player.atkT / atkTotal : 0,
    rolling: Player.rollT > 0,
    ult: Player.ultT > 0,
    armed, crouch: Player.crouchT > 0, hurt: Player.hurtT > 0,
    spin: Player.spinT > 0, wcast: Player.atkKind === 'wcast',
  });
  // Flow aura shell while the meter is full
  if (Player.flow >= 100 && !Player.aura) {
    Player.aura = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.22, depthWrite: false }));
    Player.aura.position.y = 1.2;
    playerRig.group.add(Player.aura);
  } else if (Player.flow < 100 && Player.aura) {
    playerRig.group.remove(Player.aura); Player.aura = null;
  }
  if (!Player.grounded) playerRig.group.rotation.x = -0.25;
  updateCamera(dt);
  if (Math.floor(Game.time * 4) !== Math.floor((Game.time - dt) * 4)) drawMinimap();
  // autosave heartbeat
  if (Math.floor(Game.time) % 20 === 0 && !Game._saved) { Game._saved = true; Game.save(); }
  if (Math.floor(Game.time) % 20 !== 0) Game._saved = false;
  renderer.render(scene, camera);
}

function startGame(fresh) {
  AudioSys.init();
  AudioSys.ctx?.resume?.();
  if (fresh) { clearSave(); }
  $('title-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  Game.state = 'playing';
  Game.camYaw = Math.PI - 0.7; // open view past the shrine obelisk
  Game.subtitle(fresh
    ? 'Ionia, forgotten. Find the shrines. Steel yourself. Your brother waits NORTH.'
    : 'The wind remembers you. Continue the path — north, to Yone.', 6);
  canvas.requestPointerLock?.();
}

/* ---- init ---- */
buildWorld();
populateEnemies();
spawnBoss();
Particles.init();
buildPlayerMesh();
Input.init(canvas);
Player.y = groundH(Player.x, Player.z);
playerRig.group.position.set(Player.x, Player.y, Player.z);
drawPortrait();
updateHUD();

const prevSave = loadSave();
if (prevSave && (prevSave.level > 1 || prevSave.bossDefeated || (prevSave.xp || 0) > 0)) {
  $('btn-continue').classList.remove('hidden');
  $('save-lv').textContent = prevSave.level || 1;
}
$('btn-start').addEventListener('click', () => {
  if (prevSave && !$('btn-continue').classList.contains('hidden')) { /* fresh start requested */ }
  clearSave();
  Player.level = 1; Player.xp = 0; Player.gold = 0; Player.atk = 10;
  Player.maxHp = 100; Player.hp = 100; Player.blade = 'WEATHERED KATANA';
  Player.shrineIdx = 0; Player.x = 6; Player.z = 27;
  Game.bossDefeated = false;
  startGame(true);
});
$('btn-continue').addEventListener('click', () => { applySave(prevSave); startGame(false); });
$('btn-respawn').addEventListener('click', () => Game.respawn());
$('btn-keep-exploring').addEventListener('click', () => {
  $('victory-screen').classList.add('hidden');
  Game.state = 'playing';
  Game.subtitle('The realm exhales. Seven seals tremble… the road goes on.', 5);
});
$('btn-resume').addEventListener('click', () => Game.togglePause());
$('btn-wipe').addEventListener('click', () => { clearSave(); Game.toast('Save erased.'); Game.togglePause(); });

// first-frame title backdrop: place camera over the realm
camera.position.set(20, 14, 40);
camera.lookAt(0, 2, -40);
loop();

// debug hook for automated checks
window.__game = { Game, Player, THREE, hurtEnemy, killEnemy, hurtPlayer, spawnProjectile, castQ, castR, castE, castW };
