// js/main.js
// Import required libraries directly so we don't rely on globals
import * as THREE from '../vendor/three.module.js';
import SimplexNoise from 'https://cdn.jsdelivr.net/npm/simplex-noise@3.0.0/dist/esm/simplex-noise.js';

const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

window.onload = () => {
  function setupMobileControls() {
    document.getElementById('joystick-zone').style.display = 'block';
    document.getElementById('shoot-button').style.display = 'block';

    // ─── Movement Joystick ───────────────
    const joystick = nipplejs.create({
      zone: document.getElementById('joystick-zone'),
      mode: 'static',
      position: { left: '75px', bottom: '75px' },
      color: 'white',
      size: 150
    });

    joystick.on('move', (evt, data) => {
      const x = data.vector.x;
      const y = data.vector.y;
      move.f = Math.max(0, y);
      move.b = Math.max(0, -y);
      move.l = Math.max(0, -x);
      move.r = Math.max(0, x);
      joystickIntensity = Math.min(1, data.distance / (joystick.options.size / 2));
      shiftHeld = manualSprint || joystickIntensity > 0.9;
    });

    joystick.on('end', () => {
      move.f = move.b = move.l = move.r = 0;
      joystickIntensity = 0;
      shiftHeld = manualSprint || joystickIntensity > 0.9;
    });

    // ─── Screen Drag Look ───────────────
    let lookTouch = null, lastLX = 0, lastLY = 0;
    const okLook = el =>
      !el.closest('#joystick-zone') &&
      !el.closest('#shoot-button') &&
      !el.closest('#fly-toggle-button');

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
      if (!loadedBullet) { recallProjectile(); return; }
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

    // ─── Screen Tap Flight Controls ──────
    let lastTopTap = 0;
    let lastBottomTap = 0;

    const handleScreenTouch = e => {
      if (e.touches.length > 1) return;
      const t = e.changedTouches[0];
      if (!t ||
          t.target.closest('#joystick-zone') ||
          t.target.closest('#shoot-button') ||
          t.target.closest('#fly-toggle-button')) return;
      const top = t.clientY < innerHeight / 2;
      const now = performance.now();
      if (top) {
        if (now - lastTopTap < 300) {
          flyMode = true;
        } else if (!flyMode && onGround) {
          vertVel = 12;
          onGround = false;
        } else if (flyMode) {
          spaceHeld = true;
        }
        lastTopTap = now;
      } else {
        if (now - lastBottomTap < 300) {
          flyMode = false;
        } else if (flyMode) {
          zHeld = true;
        }
        lastBottomTap = now;
      }
    };

    const endScreenTouch = () => { spaceHeld = false; zHeld = false; };

    renderer.domElement.addEventListener('touchstart', handleScreenTouch, { passive: true });
    renderer.domElement.addEventListener('touchend', endScreenTouch, { passive: true });
    renderer.domElement.addEventListener('touchcancel', endScreenTouch, { passive: true });

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
const NOISE_SCALE     = 0.004, NOISE_AMP = 30, NOISE_OCTS = 6;
const TEXTURE_SIZE    = 256;               // resolution of procedural texture
const MAX_DT          = 0.05;
const MAX_HEALTH      = 100;
const mapSeed         = '🌎';                 // constant → identical terrain
const noiseSky        = new SimplexNoise(mapSeed + 'sky');

/* ───────────────────────── GLOBAL SINGLETONS ──────────────────────── */
const socket      = new WebSocket(WS_URL);
const ghosts      = new Map();            // id → remote avatar
const prevPos     = new Map();            // id → {x,z} for walk anim
const remoteShots = new Map();            // id → true  (already spawned)
const projectiles = [];                   // my bullets + remote ones
const projectilesGroup = new THREE.Group();  // kept for legacy; harmless
const CLOCK       = new THREE.Clock();
const tmpVec      = new THREE.Vector3();
const spikes      = [];                   // active terrain spikes
const hitEffects  = [];                   // transient hit visuals
const damageTimers= new Map();            // material → remaining flash time
let   prevMyHealth= MAX_HEALTH;

let   myId        = null;
let   myColor     = new THREE.Color(0x222222);
let   myHealth    = MAX_HEALTH;

function updateHealthBar() {
  const fill = document.getElementById('health-fill');
  if (fill) fill.style.width = `${myHealth}%`;
}
let   character, bodyMesh, headMesh, Larm, Rarm, Lleg, Rleg;
let   boxGeo, octGeo, bulletMat, loadedBullet = null;
let   terrain, noise;
let   yaw = 0, pitch = 0;
let   charging = false, chargeStart = 0, currentCharge = 0;
let   vertVel = 0, onGround = false, flyMode = false;
let   spaceHeld = false, zHeld  = false;
let   manualSprint = false, shiftHeld = false, joystickIntensity = 0;
let   lastSpace = 0, lastZ = 0;
const move = { f:0, b:0, l:0, r:0 };

// ─────────── TARGET STATE ───────────
let activeTarget   = null;   // { id, x, z }
const TARGET_RADIUS = 5;     // must match server’s radius
let targetMesh     = null;   // Three.js mesh for the pillar/flag


/* ──────────────────── DOM + RENDER TARGET SET-UP ─────────────────── */
const scene     = new THREE.Scene();
// Use a lighter gray to give the world a softer backdrop
scene.background = new THREE.Color(0xcccccc);
// --- SKY SPHERE SETUP ---
let skyMesh;
function generateSkyTexture(size){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');
  const img=ctx.createImageData(size,size);
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const n1=noiseSky.noise2D(x/size*3,y/size*3);
      const n2=noiseSky.noise2D((x+1000)/size*2,(y+1000)/size*2);
      const hue=((n1+n2)*0.25+0.5)%1;
      const c=new THREE.Color();
      c.setHSL(hue,0.7,0.5);
      const idx=(y*size+x)*4;
      img.data[idx]=c.r*255;
      img.data[idx+1]=c.g*255;
      img.data[idx+2]=c.b*255;
      img.data[idx+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const tex=new THREE.CanvasTexture(canvas);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(3,2);
  return tex;
}
// Commented out static sky texture for a simple dark backdrop
// const skyTex = new THREE.TextureLoader().load('assets/star_sky.jpg');
// skyTex.wrapS = skyTex.wrapT = THREE.RepeatWrapping;
// const geometry=new THREE.SphereGeometry(350,64,64);
// const material=new THREE.MeshBasicMaterial({
//   map: skyTex,
//   side:THREE.BackSide
// });
// skyMesh=new THREE.Mesh(geometry,material);
// scene.add(skyMesh);

// Simple light gray sky sphere with PBR material
skyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(350, 64, 64),
  // Use a standard material so we can control metalness and roughness
  new THREE.MeshStandardMaterial({
    color: 0xcccccc,    // light gray
    metalness: 1,
    roughness: 1,
    side: THREE.BackSide
  })
);
scene.add(skyMesh);
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
let   showTimer  = null;
['mousemove','mousedown','keydown','touchstart'].forEach(evt =>
  document.addEventListener(evt, () => {
    infoEl.style.opacity = '0';
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      infoEl.style.opacity = '1';
    }, 10000);
  }, { passive:true })
);

/* ──────────────────────────── SOCKET I/O ─────────────────────────── */
socket.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  switch (msg.t) {

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

    case 'terrainSpike': {
      const { x,z,r,delay } = msg;
      spawnTerrainSpike(x, z, r, (delay||1000)/1000);
    } break;

    case 'playerDied': {
      if (msg.id === myId) {
        teleport();
      }
    } break;
  }
});

/* ─────────────────────────── TERRAIN LOAD ────────────────────────── */
noise = new SimplexNoise(mapSeed);
initTerrain().then(() => {
  initCharacter();
  updateHealthBar();
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
  // Use a simple material without external textures or vertex colors
  const mat = new THREE.MeshStandardMaterial({
    color: 0x444444, // darker gray for the terrain
    metalness: 1,
    roughness: 1
  });
  const geo = new THREE.PlaneGeometry(GRID*SPAN, GRID*SPAN, GRID, GRID);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for (let i=0; i<pos.count; i++){
    const x = pos.getX(i) + HALF;
    const z = pos.getZ(i) + HALF;
    const y = getNoise(x/SPAN, z/SPAN);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  terrain = new THREE.Mesh(geo, mat);
  scene.add(terrain);
  res();
  });
}
function deformTerrain(impact,radius,depth){
  const pos=terrain.geometry.attributes.position;
  for(let i=0;i<pos.count;i++){
    const dx=pos.getX(i)-impact.x, dz=pos.getZ(i)-impact.z;
    const dist=Math.hypot(dx,dz);
    if(dist<radius){
      const falloff = 1-dist/radius;
      pos.setY(i,pos.getY(i)-falloff*depth);
    }
  }
  pos.needsUpdate=true;
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
    if (e.button !== 0) return;
    if (!loadedBullet) { recallProjectile(); return; }
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
    returning:false, ttl:TTL_SECONDS, id:undefined,
    owner: myId
  });

  if(socket.readyState===1&&myId){
    socket.send(JSON.stringify({
      t:'shot',
      data:{ x:start.x,y:start.y,z:start.z, dir, c }
    }));
  }
  loadedBullet=null;
}

function recallProjectile(){
  if(loadedBullet){
    charging = false;
    currentCharge = 0;
    shootProjectile();
    return;
  }
  for(const p of projectiles){
    if(p.id===undefined) p.returning = true;
  }
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
  const hbMat = new THREE.SpriteMaterial({ color:0x00ff00 });
  const hb    = new THREE.Sprite(hbMat);
  hb.scale.set(1,0.1,1);
  hb.position.set(0,3.6,0);
  root.add(hb);
  root.userData={ body,head,Larm,Rarm,Lleg,Rleg, mat,
    boxGeo, octGeo:new THREE.OctahedronGeometry(1,0).rotateX(Math.PI/2),
    healthBar:hb };
  scene.add(root);
  ensureRemoteHasLoadedBullet(root,col);
  return root;
}

/* ────────────────────────── SNAPSHOT HANDLER ─────────────────────── */
  function applySnapshot({ players:pack, projectiles:shots }){
  if (pack[myId] && typeof pack[myId].health === 'number') {
    const newH = pack[myId].health;
    if(newH < prevMyHealth && bodyMesh){
      flashMaterial(bodyMesh.material);
      spawnHitEffect(character.position.clone());
    }
    myHealth = newH;
    prevMyHealth = newH;
    const scale = Math.max(0, myHealth / MAX_HEALTH);
    if (bodyMesh) {
      bodyMesh.scale.y = scale;
      bodyMesh.visible = scale > 0;
    }
    updateHealthBar();
  }

  /* ---------- players ---------- */
  for(const [id,st] of Object.entries(pack)){
    if(id===myId) continue;
    const av=ghosts.get(id) ?? makeRemoteAvatar(st.color);
    ghosts.set(id,av);
    av.position.set(st.x,st.y,st.z);
    av.rotation.y = st.yaw;
    av.userData.mat.color.set(st.color);

    if (typeof st.health === 'number') {
      if(av.userData.lastHealth!==undefined && st.health < av.userData.lastHealth){
        flashMaterial(av.userData.mat);
        spawnHitEffect(av.position.clone());
      }
      av.userData.lastHealth = st.health;
      av.userData.health = st.health;
      const scale = Math.max(0, st.health / MAX_HEALTH);
      av.userData.body.scale.y = scale;
      av.userData.body.visible = scale > 0;
      av.userData.healthBar.material.color.setHSL(scale * 0.3, 1, 0.5);
      av.userData.healthBar.scale.x = Math.max(0.01, scale);
    }

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
  ghosts.forEach((av,id)=>{
    if(!(id in pack)) av.visible=false;
    av.userData.healthBar.lookAt(camera.position);
  });

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
      id:s.id,
      owner:s.owner
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
    case'ShiftLeft':case'ShiftRight':
      manualSprint = true;
      shiftHeld = manualSprint || joystickIntensity > 0.9;
      break;
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
    case'ShiftLeft':case'ShiftRight':
      manualSprint = false;
      shiftHeld = manualSprint || joystickIntensity > 0.9;
      break;
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

    let hitPlayer = false;
    if(p.owner===myId && !p.returning){
      ghosts.forEach((av,id)=>{
        if(hitPlayer) return;
        const d=p.mesh.position.distanceTo(av.position);
        if(d<1){
          socket.send(JSON.stringify({t:'hitPlayer', target:id, shotId:p.id}));
          flashMaterial(av.userData.mat);
          spawnHitEffect(av.position.clone());
          hitPlayer=true;
        }
      });
      if(hitPlayer){
        p.returning = true;
      }
    }
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

  /* update terrain spikes */
  for(let i=spikes.length-1;i>=0;i--){
    const s=spikes[i];
    s.age+=dt;
    const t=Math.min(1,s.age/s.delay);
    s.mesh.scale.y=THREE.MathUtils.lerp(0.01,1,t);
    if(s.age>s.delay+0.5){
      scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
      spikes.splice(i,1);
    }
  }

  /* update hit effects */
  for(let i=hitEffects.length-1;i>=0;i--){
    const e=hitEffects[i];
    e.time-=dt;
    if(e.time<=0){
      scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose();
      hitEffects.splice(i,1);
    }else{
      e.mesh.material.opacity=e.time/0.3;
      e.mesh.scale.setScalar(1+(0.3-e.time));
    }
  }

  /* update damage flashes */
  damageTimers.forEach((time,mat)=>{
    time-=dt;
    if(time<=0){
      mat.emissive.copy(mat.userData.baseEmissive);
      damageTimers.delete(mat);
    }else{
      const base=mat.userData.baseEmissive;
      const c=base.clone().lerp(new THREE.Color(0xff0000),time/0.2);
      mat.emissive.copy(c);
      damageTimers.set(mat,time);
    }
  });

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
    const baseSpeed = flyMode ? 20 : 10;
    const speedMult = isMobile ? 1 + joystickIntensity : (shiftHeld ? 2 : 1);
    character.position.addScaledVector(dir, baseSpeed * speedMult * dt);
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

function spawnTerrainSpike(x,z,r,delay){
  const h = meshHeightAt(x,z);
  const geo = new THREE.ConeGeometry(r*0.5,r*2,8);
  const mat = new THREE.MeshStandardMaterial({ color:0x8844ff });
  const mesh = new THREE.Mesh(geo,mat);
  mesh.position.set(x,h,z);
  mesh.scale.y = 0.01;
  scene.add(mesh);
  spikes.push({ mesh, age:0, delay });
}

function spawnHitEffect(pos){
  const g = new THREE.SphereGeometry(0.3,8,8);
  const m = new THREE.MeshBasicMaterial({ color:0xff0000, transparent:true });
  const mesh = new THREE.Mesh(g,m);
  mesh.position.copy(pos);
  scene.add(mesh);
  hitEffects.push({ mesh, time:0.3 });
}

function flashMaterial(mat){
  if(!mat.userData.baseEmissive){
    mat.userData.baseEmissive = mat.emissive.clone();
  }
  damageTimers.set(mat,0.2);
  mat.emissive.set(0xff0000);
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
