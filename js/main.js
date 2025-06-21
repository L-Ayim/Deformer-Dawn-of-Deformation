// js/main.js
// Import required libraries directly so we don't rely on globals
import * as THREE from '../vendor/three.module.js';
import SimplexNoise from 'https://cdn.jsdelivr.net/npm/simplex-noise@3.0.0/dist/esm/simplex-noise.js';

window.onload = () => {

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function setupMobileControls() {
    document.getElementById('joystick-zone').style.display = 'block';
    document.getElementById('shoot-button').style.display = 'block';
    document.getElementById('up-button').style.display = 'block';
    document.getElementById('sprint-button').style.display = 'block';

    // ─── Movement Joystick ───────────────
    const joystick = nipplejs.create({
      zone: document.getElementById('joystick-zone'),
      mode: 'static',
      position: { left: '75px', bottom: '75px' },
      color: 'white',
      size: 100
    });

    joystick.on('move', (evt, data) => {
      const x = data.vector.x;
      const y = data.vector.y;
      move.f = y >  0.3 ? 1 : 0;
      move.b = y < -0.3 ? 1 : 0;
      move.l = x < -0.3 ? 1 : 0;
      move.r = x >  0.3 ? 1 : 0;
    });

    joystick.on('end', () => {
      move.f = move.b = move.l = move.r = 0;
    });

    // ─── Screen Drag Look ───────────────
    let lookTouch = null, lastLX = 0, lastLY = 0;
    const okLook = el =>
      !el.closest('#joystick-zone') &&
      !el.closest('#shoot-button') &&
      !el.closest('#up-button') &&
      !el.closest('#down-button') &&
      !el.closest('#sprint-button');

    renderer.domElement.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      if (!t || !okLook(e.target)) return;
      lookTouch = t.identifier;
      lastLX = t.clientX;
      lastLY = t.clientY;
    }, { passive: true });

    renderer.domElement.addEventListener('touchmove', e => {
      const t = Array.from(e.changedTouches).find(t => t.identifier === lookTouch);
      if (!t) return;
      const dx = t.clientX - lastLX;
      const dy = t.clientY - lastLY;
      lastLX = t.clientX;
      lastLY = t.clientY;
      yaw   -= dx * 0.005;
      pitch += dy * 0.005; // invert vertical drag direction
      pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, pitch));
    }, { passive: false });

    const endLook = e => {
      if (Array.from(e.changedTouches).some(t => t.identifier === lookTouch)) {
        lookTouch = null;
      }
    };
    renderer.domElement.addEventListener('touchend', endLook, { passive: true });
    renderer.domElement.addEventListener('touchcancel', endLook, { passive: true });

    // ─── Shoot Button ────────────────────
    const shootBtn = document.getElementById('shoot-button');
    shootBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!loadedBullet) return;
      charging = true;
      chargeStart = performance.now();
    });
    shootBtn.addEventListener('touchend', e => {
      e.preventDefault();
      if (!charging) return;
      charging = false;
      currentCharge = Math.min(1, (performance.now() - chargeStart) / 1000 / CHARGE_TIME_MAX);
      shootProjectile();
    });

    // ─── Jump/Fly Controls ───────────────
    const upBtn   = document.getElementById('up-button');
    const downBtn = document.getElementById('down-button');

    let lastUpTap = 0;
    let lastDownTap = 0;

    const onUpStart = () => {
      const now = performance.now();
      if (now - lastUpTap < 300) {
        flyMode = true;
        downBtn.style.display = 'block';
      } else if (!flyMode && onGround) {
        vertVel = 12;
        onGround = false;
      }
      lastUpTap = now;
      spaceHeld = true;
    };

    const onUpEnd = () => { spaceHeld = false; };

    upBtn.addEventListener('touchstart', e => { e.preventDefault(); onUpStart(); });
    upBtn.addEventListener('touchend',   e => { e.preventDefault(); onUpEnd(); });

    const onDownStart = () => {
      const now = performance.now();
      if (now - lastDownTap < 300) {
        flyMode = false;
        downBtn.style.display = 'none';
      }
      zHeld  = true;
      lastDownTap = now;
    };

    const onDownEnd = () => { zHeld  = false; };

    downBtn.addEventListener('touchstart', e => { e.preventDefault(); onDownStart(); });
    downBtn.addEventListener('touchend',   e => { e.preventDefault(); onDownEnd(); });

    // ─── Sprint Button ───────────────────
    const sprintBtn = document.getElementById('sprint-button');
    const onSprintStart = () => { shiftHeld = true; };
    const onSprintEnd   = () => { shiftHeld = false; };
    sprintBtn.addEventListener('touchstart', e => { e.preventDefault(); onSprintStart(); });
    sprintBtn.addEventListener('touchend',   e => { e.preventDefault(); onSprintEnd(); });
    sprintBtn.addEventListener('touchcancel', onSprintEnd);
  }



/* ──────────────────────────── CONSTANTS ───────────────────────────── */
const host = location.hostname;
const WS_URL          = `ws://${host}:3000`;
const GRID            = 300,  SPAN = 1,  HALF = GRID * SPAN / 2;
const DEFORM_RADIUS   = 1,    DEFORM_DEPTH = 3;
const SPEED_OUT       = 100,  SPEED_RETURN  = 120;
const MAX_OUT_RANGE   = 120,  MAX_LOST_DIST = 300;
const TTL_SECONDS     = 8,    CATCH_RADIUS  = 0.6;
const CHARGE_TIME_MAX = 1.5,  MIN_SCALE = 1, MAX_SCALE = 3;
const MIN_SPEED_OUT   = SPEED_OUT,  MAX_SPEED_OUT = SPEED_OUT * 2;
const MIN_RANGE_OUT   = MAX_OUT_RANGE, MAX_RANGE_OUT = MAX_OUT_RANGE * 2;
const MIN_CRATER      = DEFORM_RADIUS, MAX_CRATER   = DEFORM_RADIUS * 3;
const NOISE_SCALE     = 0.002, NOISE_AMP = 8, NOISE_OCTS = 5;
const COLOR_FREQ      = 0.1;               // noise frequency for vertex colors
const TEXTURE_SIZE    = 256;               // resolution of procedural texture
const MAX_DT          = 0.05;
const mapSeed         = '🌎';                 // constant → identical terrain

/* ───────────────────────── GLOBAL SINGLETONS ──────────────────────── */
const socket      = new WebSocket(WS_URL);
const ghosts      = new Map();            // id → remote avatar
const prevPos     = new Map();            // id → {x,z} for walk anim
const remoteShots = new Map();            // id → true  (already spawned)
const projectiles = [];                   // my bullets + remote ones
const projectilesGroup = new THREE.Group();  // kept for legacy; harmless
const CLOCK       = new THREE.Clock();
const tmpVec      = new THREE.Vector3();

let   myId        = null;
let   myColor     = new THREE.Color(0x222222);
// ─── insert here ───
const scores = new Map();  // id → score

function updateScoreboard() {
  const ol = document.getElementById('leaderboard-list');
  ol.innerHTML = '';
  [...scores.entries()]
    .sort((a,b) => b[1] - a[1])
    .forEach(([id, pts]) => {
      const li = document.createElement('li');
      li.textContent = (id === myId ? 'You' : id) + ': ' + pts;
      ol.appendChild(li);
    });
}
let   character, bodyMesh, headMesh, Larm, Rarm, Lleg, Rleg;
let   boxGeo, octGeo, bulletMat, loadedBullet = null;
let   terrain, noise;
let   yaw = 0, pitch = 0;
let   charging = false, chargeStart = 0, currentCharge = 0;
let   vertVel = 0, onGround = false, flyMode = false;
let   spaceHeld = false, zHeld  = false, shiftHeld = false;
let   lastSpace = 0, lastZ = 0;
const move = { f:0, b:0, l:0, r:0 };

// ─────────── TARGET STATE ───────────
let activeTarget   = null;   // { id, x, z }
const TARGET_RADIUS = 5;     // must match server’s radius
let targetMesh     = null;   // Three.js mesh for the pillar/flag


/* ──────────────────── DOM + RENDER TARGET SET-UP ─────────────────── */
const scene     = new THREE.Scene();
// --- SKY SPHERE SETUP ---
let skyMesh;
const loader = new THREE.TextureLoader();
loader.load('assets/star_sky.jpg', function(texture) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2); // adjust for more/less tiling as you like
  const geometry = new THREE.SphereGeometry(350, 64, 64);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide
  });
  skyMesh = new THREE.Mesh(geometry, material);
  scene.add(skyMesh);
});
// --- END SKY SPHERE SETUP ---

scene.add(new THREE.HemisphereLight(0x87ceeb, 0x664422, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1,2,0.5).normalize();
scene.add(sun);

const camera   = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio,1));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
  if (isMobile) setupMobileControls();

/* GPS path mesh */
let pathMesh = null;

/* simple “idle controls” overlay fade */
const infoEl     = document.getElementById('info');
const leaderboardEl = document.getElementById('leaderboard');
let   showTimer  = null;
['mousemove','mousedown','keydown','touchstart'].forEach(evt =>
  document.addEventListener(evt, () => {
    infoEl.style.opacity = '0';
    leaderboardEl.style.opacity = '0';
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      infoEl.style.opacity = '1';
      leaderboardEl.style.opacity = '1';
    }, 10000);
  }, { passive:true })
);

/* ──────────────────────────── SOCKET I/O ─────────────────────────── */
socket.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  switch (msg.t) {
case 'scoreUpdate': {
  // new: full‐board seed
  // msg.scores is an object { id: score, … }
  Object.entries(msg.scores).forEach(([id, pts]) => {
    scores.set(id, pts);
  });
  updateScoreboard();
  break;
}

    case 'welcome':
      myId    = msg.id;
      myColor = new THREE.Color().setStyle(msg.color);

      // Update avatar colors if we've already built the character
      if (bodyMesh) {
        bodyMesh.material.color.copy(myColor);
        bodyMesh.material.emissive.copy(myColor).multiplyScalar(0.25);
      }
      if (bulletMat) {
        bulletMat.color.copy(myColor);
        bulletMat.emissive.copy(myColor).multiplyScalar(0.25);
      }

      // NOW it’s safe to seed your entry
      scores.set(myId, 0);
      updateScoreboard();
      break;
    case 'snapshot':
      applySnapshot(msg);
      break;
    case 'newTarget': {
    // server just spawned one
    activeTarget = msg.target;            // { id, x, z }

      // remove any old marker
      if (targetMesh) {
     scene.remove(targetMesh);
      targetMesh.geometry.dispose();
      targetMesh.material.dispose();
    }

    // create a simple pillar or flag at (x,z)
    const height   = meshHeightAt(activeTarget.x, activeTarget.z);
    const geom     = new THREE.CylinderGeometry(0.5,0.5, 3, 8);
    const mat      = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    targetMesh     = new THREE.Mesh(geom, mat);
    targetMesh.position.set(activeTarget.x, height + 1.5, activeTarget.z);
    scene.add(targetMesh);
    if (pathMesh) {
      scene.remove(pathMesh);
      pathMesh.geometry.dispose();
      pathMesh.material.dispose();
      pathMesh = null;
    }
    updatePathMesh();
    break;
    }

    case 'crater': {
      const { x,z,r,d } = msg.crater;
      deformTerrain(new THREE.Vector3(x,0,z), r, d);
      ghosts.forEach(av => {
        const gY = meshHeightAt(av.position.x, av.position.z) + 2;
        if (av.position.y < gY) av.position.y = gY;
      });
    } break;
  }
});

/* ─────────────────────────── TERRAIN LOAD ────────────────────────── */
noise = new SimplexNoise(mapSeed);
initTerrain().then(() => {
  initCharacter();
  requestAnimationFrame(animate);
});

/* ───────────────────────────── TERRAIN ───────────────────────────── */
function getNoise(u,v){
  let h=0, freq=NOISE_SCALE, amp=NOISE_AMP;
  for (let i=0;i<NOISE_OCTS;i++){
    h += noise.noise2D(u*freq,v*freq)*amp;
    freq*=2; amp*=0.5;
  }
  return h;
}
function sampleHybridNormal(u,v){
  const e=1;
  const hL=getNoise(u-e,v), hR=getNoise(u+e,v);
  const hD=getNoise(u,v-e), hU=getNoise(u,v+e);
  return new THREE.Vector3(hL-hR,2*e,hD-hU).normalize();
}

function generateNoiseTexture(size){
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const n = (noise.noise2D(x/size*4, y/size*4)+1)/2;
      const c = Math.floor(n*255);
      const idx = (y*size+x)*4;
      img.data[idx] = img.data[idx+1] = img.data[idx+2] = c;
      img.data[idx+3] = 255;
    }
  }
  ctx.putImageData(img,0,0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4,4);
  return tex;
}
function initTerrain(){
  return new Promise(res => {
  const diffuseMap = generateNoiseTexture(TEXTURE_SIZE);
  const overlayMap = generateNoiseTexture(TEXTURE_SIZE);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  diffuseMap.anisotropy = maxAnisotropy;
  overlayMap.anisotropy = maxAnisotropy;

  const mat = new THREE.MeshStandardMaterial({
    map: diffuseMap,
    aoMap: overlayMap,
    aoMapIntensity: 1.5,
    metalness: 0.1,
    roughness: 0.9,
    vertexColors: true
  });
  const geo = new THREE.PlaneGeometry(GRID*SPAN, GRID*SPAN, GRID, GRID);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count*3);
  const color = new THREE.Color();
  for (let i=0; i<pos.count; i++){
    const x = pos.getX(i) + HALF;
    const z = pos.getZ(i) + HALF;
    const y = getNoise(x/SPAN, z/SPAN);
    pos.setY(i, y);
    const n = noise.noise2D(x*COLOR_FREQ, z*COLOR_FREQ);
    const hNorm = (y + NOISE_AMP) / (NOISE_AMP*2);
    color.setHSL(0.3 - hNorm*0.25 + n*0.05, 0.6, 0.3 + hNorm*0.5);
    colors[i*3] = color.r; colors[i*3+1] = color.g; colors[i*3+2] = color.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
  geo.computeVertexNormals();
  terrain = new THREE.Mesh(geo, mat);
  scene.add(terrain);
  res();
  });
}
function deformTerrain(impact,radius,depth){
  const pos=terrain.geometry.attributes.position;
  const col=terrain.geometry.attributes.color;
  const tmpColor=new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const dx=pos.getX(i)-impact.x, dz=pos.getZ(i)-impact.z;
    const dist=Math.hypot(dx,dz);
    if(dist<radius){
      const falloff = 1-dist/radius;
      pos.setY(i,pos.getY(i)-falloff*depth);
    }
    const x=pos.getX(i)+HALF;
    const z=pos.getZ(i)+HALF;
    const y=pos.getY(i);
    const n=noise.noise2D(x*COLOR_FREQ,z*COLOR_FREQ);
    const hNorm=(y+NOISE_AMP)/(NOISE_AMP*2);
    tmpColor.setHSL(0.3 - hNorm*0.25 + n*0.05,0.6,0.3 + hNorm*0.5);
    col.setXYZ(i,tmpColor.r,tmpColor.g,tmpColor.b);
  }
  pos.needsUpdate=true;
  col.needsUpdate=true;
  terrain.geometry.computeVertexNormals();
}
function meshHeightAt(x,z){
  if (!terrain) return 0;
  const size=GRID*SPAN;
  const gx=Math.round((x+size/2)/SPAN);
  const gz=Math.round((z+size/2)/SPAN);
  const ix=THREE.MathUtils.clamp(gx,0,GRID);
  const iz=THREE.MathUtils.clamp(gz,0,GRID);
  const idx=iz*(GRID+1)+ix;
  return terrain.geometry.attributes.position.getY(idx);
}

/* ─────────────────────── LOCAL CHARACTER ─────────────────────────── */
const bulletGeo = new THREE.SphereGeometry(0.2,8,8);
function initCharacter(){
  character = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color:myColor.clone(), emissive:myColor.clone().multiplyScalar(0.25)
  });
  bulletMat = mat.clone();
  boxGeo = new THREE.BoxGeometry(1,2,1);
  octGeo = new THREE.OctahedronGeometry(1,0).rotateX(Math.PI/2);

  bodyMesh = new THREE.Mesh(boxGeo,mat); bodyMesh.position.y=1;
  headMesh = new THREE.Mesh(new THREE.TorusGeometry(0.6,0.2,16,100),mat);
  headMesh.position.y=3.2;
  character.add(bodyMesh,headMesh);

  const armGeo=new THREE.BoxGeometry(0.4,1.5,0.4);
  Larm=new THREE.Mesh(armGeo,mat); Rarm=new THREE.Mesh(armGeo,mat);
  Larm.position.set(-0.9,1.25,0); Rarm.position.set(0.9,1.25,0);
  character.add(Larm,Rarm);

  const legGeo=new THREE.BoxGeometry(0.5,1.8,0.5);
  Lleg=new THREE.Mesh(legGeo,mat); Rleg=new THREE.Mesh(legGeo,mat);
  Lleg.position.set(-0.3,-0.9,0); Rleg.position.set(0.3,-0.9,0);
  character.add(Lleg,Rleg);

  scene.add(character);
  scene.add(projectilesGroup);
  teleport();
  spawnLoadedBullet();

  /* mouse input for charge shot */
if (!isMobile) {
  renderer.domElement.addEventListener('mousedown', e => {
    if (e.button !== 0 || !loadedBullet) return;
    charging = true;
    chargeStart = performance.now();
  });

  renderer.domElement.addEventListener('mouseup', e => {
    if (!charging || e.button !== 0) return;
    charging = false;
    currentCharge = Math.min(1, (performance.now() - chargeStart) / 1000 / CHARGE_TIME_MAX);
    shootProjectile();
  });
}

}
function spawnLoadedBullet(){
  if(loadedBullet) return;
  loadedBullet = new THREE.Mesh(bulletGeo,bulletMat);
  loadedBullet.position.copy(headMesh.position);
  character.add(loadedBullet);
}
function shootProjectile(){
  if(!loadedBullet) return;
  const c=currentCharge;
  const speedOut=THREE.MathUtils.lerp(MIN_SPEED_OUT,MAX_SPEED_OUT,c);
  const rangeOut=THREE.MathUtils.lerp(MIN_RANGE_OUT,MAX_RANGE_OUT,c);
  const craterR =THREE.MathUtils.lerp(MIN_CRATER,  MAX_CRATER,  c);
  currentCharge=0;

  const start=headMesh.getWorldPosition(new THREE.Vector3());
  const dir=new THREE.Vector3(
    -Math.sin(yaw)*Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw)*Math.cos(pitch)
  ).normalize();

  character.remove(loadedBullet);
  loadedBullet.position.copy(start).add(dir.clone().multiplyScalar(0.6));
  scene.add(loadedBullet);

  projectiles.push({
    mesh:loadedBullet, velocity:dir.clone().multiplyScalar(speedOut),
    travelled:0, maxRange:rangeOut, craterRad:craterR,
    returning:false, ttl:TTL_SECONDS, id:undefined
  });

  if(socket.readyState===1&&myId){
    socket.send(JSON.stringify({
      t:'shot',
      data:{ x:start.x,y:start.y,z:start.z, dir, c }
    }));
  }
  loadedBullet=null;
}
function teleport(){
  const x=(Math.random()-0.5)*GRID*SPAN, z=(Math.random()-0.5)*GRID*SPAN;
  const y=meshHeightAt(x,z)+1;
  character.position.set(x,y,z);
  vertVel=0; onGround=true;
}

/* ───────────────────────── REMOTE AVATARS ────────────────────────── */
function ensureRemoteHasLoadedBullet(av,color){
  if(av.getObjectByName('loaded')) return;
  const ball=new THREE.Mesh(
    new THREE.SphereGeometry(0.2,8,8),
    new THREE.MeshStandardMaterial({ color })
  );
  ball.name='loaded'; ball.position.set(0,3.2,0);
  av.add(ball);
}
function makeRemoteAvatar(col){
  const baseCol=new THREE.Color().setStyle(col);
  const mat=new THREE.MeshStandardMaterial({
    color:baseCol.clone(), emissive:baseCol.clone().multiplyScalar(0.25)
  });
  const root=new THREE.Group();
  const boxGeo=new THREE.BoxGeometry(1,2,1);
  const body=new THREE.Mesh(boxGeo,mat); body.position.y=1; root.add(body);
  const head=new THREE.Mesh(new THREE.TorusGeometry(0.6,0.2,16,100),mat);
  head.position.y=3.2; root.add(head);
  const mkLimb=()=>new THREE.Mesh(new THREE.BoxGeometry(0.4,1.5,0.4),mat);
  const Larm=mkLimb(), Rarm=mkLimb();
  Larm.position.set(-0.9,1.25,0); Rarm.position.set(0.9,1.25,0);
  root.add(Larm,Rarm);
  const mkLeg=()=>new THREE.Mesh(new THREE.BoxGeometry(0.5,1.8,0.5),mat);
  const Lleg=mkLeg(), Rleg=mkLeg();
  Lleg.position.set(-0.3,-0.9,0); Rleg.position.set(0.3,-0.9,0);
  root.add(Lleg,Rleg);
  root.userData={ body,head,Larm,Rarm,Lleg,Rleg, mat,
    boxGeo, octGeo:new THREE.OctahedronGeometry(1,0).rotateX(Math.PI/2)};
  scene.add(root);
  ensureRemoteHasLoadedBullet(root,col);
  return root;
}

/* ────────────────────────── SNAPSHOT HANDLER ─────────────────────── */
  function applySnapshot({ players:pack, projectiles:shots }){
   // ─── SPREADSHEET SEEDING ───
  // For every player the server knows about, make sure we have an entry
  Object.keys(pack).forEach(id => {
    if (!scores.has(id)) {
      scores.set(id, 0);
    }
  });

  for (const id of [...scores.keys()]) {
    if (!(id in pack)) {
      scores.delete(id);
    }
  }

  updateScoreboard();
 
  /* ---------- players ---------- */
  for(const [id,st] of Object.entries(pack)){
    if(id===myId) continue;
    const av=ghosts.get(id) ?? makeRemoteAvatar(st.color);
    ghosts.set(id,av);
    av.position.set(st.x,st.y,st.z);
    av.rotation.y = st.yaw;
    av.userData.mat.color.set(st.color);

    const geo = st.flyMode ? av.userData.octGeo : av.userData.boxGeo;
    av.userData.body.geometry = geo;
    const limbs=!st.flyMode;
    av.userData.Larm.visible=
    av.userData.Rarm.visible=
    av.userData.Lleg.visible=
    av.userData.Rleg.visible = limbs;

    const theyShot = shots.some(s=>s.owner===id);
    if(theyShot){
      const b=av.getObjectByName('loaded');
      if(b) av.remove(b);
    }else{
      ensureRemoteHasLoadedBullet(av, st.color);
    }

    const prev=prevPos.get(id)??{x:st.x,z:st.z};
    const moved=(st.x-prev.x)**2+(st.z-prev.z)**2>0.0001;
    const swing=moved?Math.sin(CLOCK.getElapsedTime()*10)*0.5:0;
    av.userData.Larm.rotation.x =  swing;
    av.userData.Rarm.rotation.x = -swing;
    av.userData.Lleg.rotation.x = -swing;
    av.userData.Rleg.rotation.x =  swing;
    prevPos.set(id,{x:st.x,z:st.z});
    av.visible=true;
  }
  ghosts.forEach((av,id)=>{ if(!(id in pack)) av.visible=false; });

  /* ---------- remote bullets ---------- */
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];
    if(p.id!==undefined && !shots.some(s=>s.id===p.id)){
      scene.remove(p.mesh); projectiles.splice(i,1); remoteShots.delete(p.id);
    }
  }
  shots.forEach(s=>{
    if(s.owner===myId) return;
    if(remoteShots.has(s.id)) return;
    const dir=new THREE.Vector3(s.dir.x,s.dir.y,s.dir.z).normalize();
    const col=pack[s.owner]?.color ?? 0xffffff;
    const mesh=new THREE.Mesh(
      bulletGeo,new THREE.MeshStandardMaterial({ color:col })
    );
    mesh.position.set(s.x,s.y,s.z);
    mesh.scale.setScalar(THREE.MathUtils.lerp(MIN_SCALE,MAX_SCALE,s.c));
    scene.add(mesh);
    projectiles.push({
      mesh,
      velocity:dir.multiplyScalar(
        THREE.MathUtils.lerp(MIN_SPEED_OUT,MAX_SPEED_OUT,s.c)),
      travelled:0,
      maxRange:THREE.MathUtils.lerp(MIN_RANGE_OUT,MAX_RANGE_OUT,s.c),
      craterRad:THREE.MathUtils.lerp(MIN_CRATER,MAX_CRATER,s.c),
      returning:false,
      ttl:TTL_SECONDS,
      id:s.id
    });
    remoteShots.set(s.id,true);
  });
}

/* ────────────────────────── INPUT HANDLERS ───────────────────────── */
renderer.domElement.addEventListener('click',()=>
  renderer.domElement.requestPointerLock?.());
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===renderer.domElement){
    document.addEventListener('mousemove',onMouseMove);
  }else document.removeEventListener('mousemove',onMouseMove);
});
function onMouseMove(e){
  const S = 0.002;
  yaw   -= e.movementX * S;
  pitch += e.movementY * S; // invert the mouse's vertical look
  pitch  = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, pitch));
}
document.addEventListener('keydown',e=>{
  if(e.repeat) return; const now=performance.now();
  switch(e.code){
    case'KeyW':move.f=1;break; case'KeyS':move.b=1;break;
    case'KeyA':move.l=1;break; case'KeyD':move.r=1;break;
    case'ShiftLeft':case'ShiftRight':shiftHeld=true;break;
    case'Space':
      spaceHeld=true;
      if(now-lastSpace<300) flyMode=!flyMode;
      else if(onGround&&!flyMode){ vertVel=12; onGround=false; }
      lastSpace=now; break;
    case'KeyZ':case'KeyZ':
      zHeld =true;
      if(flyMode&&now-lastZ<300) flyMode=false;
      lastZ=now; break;
    case'Escape':teleport();break;
  }
});
document.addEventListener('keyup',e=>{
  switch(e.code){
    case'KeyW':move.f=0;break; case'KeyS':move.b=0;break;
    case'KeyA':move.l=0;break; case'KeyD':move.r=0;break;
    case'ShiftLeft':case'ShiftRight':shiftHeld=false;break;
    case'Space':spaceHeld=false;break;
    case'KeyZ':case'KeyZ':zHeld =false;break;
  }
});

/* ───────────────────────────── GAME LOOP ─────────────────────────── */
let lastFrame=0;
function animate(now){
  requestAnimationFrame(animate);
  if(!character || now-lastFrame<1000/60) return;
  lastFrame=now;
  const dt=Math.min(CLOCK.getDelta(),MAX_DT);

  /* send raw input */
  if(socket.readyState===1&&myId){
    socket.send(JSON.stringify({ t:'input',
      input:{ move,spaceHeld,zHeld ,shiftHeld }}));
  }

  /* grow charging bullet */
  if(charging&&loadedBullet){
    const held=(performance.now()-chargeStart)/1000;
    currentCharge=Math.min(1,held/CHARGE_TIME_MAX);
    const s=THREE.MathUtils.lerp(MIN_SCALE,MAX_SCALE,currentCharge);
    loadedBullet.scale.setScalar(s);
  }

  /* update bullets (mine + remote) */
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i]; p.ttl-=dt;
    const dist= p.mesh.position.distanceTo(character.position);
    if(p.ttl<=0||dist>MAX_LOST_DIST){
      scene.remove(p.mesh); projectiles.splice(i,1); spawnLoadedBullet(); continue;
    }
    const step=p.velocity.clone().multiplyScalar(dt);
    p.mesh.position.add(step); p.travelled+=step.length();

    const groundY=meshHeightAt(p.mesh.position.x,p.mesh.position.z);
    const hitGround=p.mesh.position.y<=groundY;
    if(hitGround){
          if (hitGround && activeTarget) {
      // see if we’re within radius of the active target
      const dx = p.mesh.position.x - activeTarget.x;
      const dz = p.mesh.position.z - activeTarget.z;
      if (Math.hypot(dx, dz) <= TARGET_RADIUS) {
        // first hit! tell the server
        socket.send(JSON.stringify({
          t: 'hitTarget',
          targetId: activeTarget.id
        }));
        // clear locally so we only send once
        activeTarget = null;
        if (pathMesh) {
          scene.remove(pathMesh);
          pathMesh.geometry.dispose();
          pathMesh.material.dispose();
          pathMesh = null;
        }
      }
    }

      deformTerrain(p.mesh.position.clone(),p.craterRad,DEFORM_DEPTH);
      if(socket.readyState===1&&myId){
        const c=p.mesh.position.clone();
        socket.send(JSON.stringify({ t:'crater',
          crater:{x:c.x,z:c.z,r:p.craterRad,d:DEFORM_DEPTH} }));
      }
      p.mesh.position.y=groundY+0.3;
    }
    if(!p.returning&&(hitGround||p.travelled>=p.maxRange)) p.returning=true;
    if(p.returning){
      const headPos=headMesh.getWorldPosition(tmpVec);
      const toHead=headPos.clone().sub(p.mesh.position);
      const dist=toHead.length(); const stepLen=SPEED_RETURN*dt;
      if(dist<=CATCH_RADIUS||dist<=stepLen){
        catchBoomerang(p,headPos); continue;
      }
      p.velocity.copy(toHead.normalize().multiplyScalar(SPEED_RETURN));
    }
  }

  /* geometry swap */
  if(flyMode){
    bodyMesh.geometry=octGeo;
    Larm.visible=Rarm.visible=Lleg.visible=Rleg.visible=false;
  }else{
    bodyMesh.geometry=boxGeo;
    Larm.visible=Rarm.visible=Lleg.visible=Rleg.visible=true;
  }

  /* movement */
  const dir=new THREE.Vector3(move.r-move.l,0,move.b-move.f);
  if(dir.lengthSq()){
    dir.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
    const baseSpeed=flyMode?20:10;
    character.position.addScaledVector(dir, baseSpeed*(shiftHeld?2:1)*dt);
  }

  /* vertical */
  if(flyMode){
    if(spaceHeld) character.position.y+=20*dt;
    if(zHeld ) character.position.y-=20*dt;
    const gY=meshHeightAt(character.position.x,character.position.z)+2;
    if(character.position.y<=gY){ character.position.y=gY; flyMode=false; onGround=true; vertVel=0; }
  }else{
    vertVel-=30*dt; character.position.y+=vertVel*dt;
    const gY=meshHeightAt(character.position.x,character.position.z)+2;
    if(character.position.y<=gY){ character.position.y=gY; vertVel=0; onGround=true; }
  }

  /* oob */
  if(Math.abs(character.position.x)>HALF||Math.abs(character.position.z)>HALF) teleport();

  /* tilt */
  if(!flyMode){
    const u=(character.position.x+HALF)/SPAN,v=(character.position.z+HALF)/SPAN;
    const n=sampleHybridNormal(u,v), up=new THREE.Vector3(0,1,0);
    let angle=Math.acos(THREE.MathUtils.clamp(n.dot(up),-1,1));
    angle=Math.min(angle,THREE.MathUtils.degToRad(5));
    const axis=new THREE.Vector3().crossVectors(up,n).normalize();
    const q=new THREE.Quaternion().setFromAxisAngle(axis,angle);
    const sUp=up.clone().applyQuaternion(q).normalize();
    character.up.copy(sUp);
    const sq=new THREE.Quaternion().setFromUnitVectors(up,sUp);
    const fwd=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)).applyQuaternion(sq);
    character.lookAt(character.position.clone().add(fwd));
  }else{
    character.up.set(0,1,0);
    const fwd=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    character.lookAt(character.position.clone().add(fwd));
  }

  /* walk anim for me */
  const walking=dir.lengthSq()>0&&!flyMode;
  if(walking){
    const swing=Math.sin(CLOCK.getElapsedTime()*10)*0.5;
    Larm.rotation.x=swing; Rarm.rotation.x=-swing;
    Lleg.rotation.x=-swing; Rleg.rotation.x=swing;
  }else{
    Larm.rotation.x=Rarm.rotation.x=Lleg.rotation.x=Rleg.rotation.x=0;
  }

  /* camera */
  const Rcam=8;
  const camOff=new THREE.Vector3(
    Rcam*Math.sin(yaw)*Math.cos(pitch),
    Rcam*Math.sin(pitch)+3,
    Rcam*Math.cos(yaw)*Math.cos(pitch)
  );
  camera.position.copy(character.position).add(camOff);
  camera.lookAt(character.position);

  /* send pose */
  if(socket.readyState===1&&myId){
    socket.send(JSON.stringify({ t:'state',
      state:{ x:character.position.x, y:character.position.y,
              z:character.position.z, yaw, pitch, flyMode }}));
  }

  if (skyMesh) {
  skyMesh.position.copy(camera.position);
}


  renderer.render(scene,camera);

  /* GPS path */
  if (activeTarget && !pathMesh) {
    updatePathMesh();
  }

}
window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

function createPathStrip(from, to, startWidth = 1, endWidth = 0.5,
                         segments = 60, startCol, endCol) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len, nz = dx / len;

  const vertCount = segments * 2 + 2;
  const pos = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = THREE.MathUtils.lerp(from.x, to.x, t);
    const z = THREE.MathUtils.lerp(from.z, to.z, t);
    const h = meshHeightAt(x, z);
    const y = (Number.isFinite(h) ? h : 0) + 0.05;
    const width = THREE.MathUtils.lerp(startWidth, endWidth, t);
    const offX = nx * width * 0.5;
    const offZ = nz * width * 0.5;

    const vi = i * 6;
    const ci = i * 6;

    const r = THREE.MathUtils.lerp(startCol.r, endCol.r, t);
    const g = THREE.MathUtils.lerp(startCol.g, endCol.g, t);
    const b = THREE.MathUtils.lerp(startCol.b, endCol.b, t);

    pos[vi]     = x + offX;
    pos[vi + 1] = y;
    pos[vi + 2] = z + offZ;
    pos[vi + 3] = x - offX;
    pos[vi + 4] = y;
    pos[vi + 5] = z - offZ;

    col[ci]     = r; col[ci + 1] = g; col[ci + 2] = b;
    col[ci + 3] = r; col[ci + 4] = g; col[ci + 5] = b;
    if (i < segments) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = i * 2 + 2;
      const d = i * 2 + 3;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function updatePathMesh() {
  if (!activeTarget || !terrain || !character) return;
  const start = character.position.clone();
  const endY = meshHeightAt(activeTarget.x, activeTarget.z) + 0.05;
  const end = new THREE.Vector3(activeTarget.x, endY, activeTarget.z);
  const geo = createPathStrip(start, end, 1.5, 0.4, 80,
                              myColor, new THREE.Color(0xffff00));
  if (pathMesh) {
    scene.remove(pathMesh);
    pathMesh.geometry.dispose();
    pathMesh.material.dispose();
  }
  pathMesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    })
  );
  scene.add(pathMesh);

  // path thickness tapers toward the destination – no arrows needed
}

/* ─────────────────────────── HELPERS ─────────────────────────────── */
function catchBoomerang(p){
  if(socket.readyState===1&&p.id!==undefined)
    socket.send(JSON.stringify({ t:'catch', shotId:p.id }));
  scene.remove(p.mesh);
  projectiles.splice(projectiles.indexOf(p),1);
  spawnLoadedBullet();
}
}; // end onload
