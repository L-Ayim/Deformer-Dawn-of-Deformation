// js/character.js
import { GRID, SPAN, meshHeightAt } from './terrain.js';
import { socket, myId } from './network.js';

// Reference to the main THREE.Scene, assigned in initCharacter
let scene;

// State values used by character behaviors
let yaw = 0, pitch = 0;
let vertVel = 0, onGround = true;
let charging = false;
let chargeStart = 0;
let currentCharge = 0;

export const SPEED_OUT = 100;
export const SPEED_RETURN = 120;
export const MAX_OUT_RANGE = 120;
export const MAX_LOST_DIST = 300;
export const TTL_SECONDS = 8;
export const CATCH_RADIUS = 0.6;
export const CHARGE_TIME_MAX = 1.5;
export const MIN_SCALE = 1;
export const MAX_SCALE = 3;
export const MIN_SPEED_OUT = SPEED_OUT;
export const MAX_SPEED_OUT = SPEED_OUT * 2;
export const MIN_RANGE_OUT = MAX_OUT_RANGE;
export const MAX_RANGE_OUT = MAX_OUT_RANGE * 2;
export const MIN_CRATER = 1;
export const MAX_CRATER = 3;

export const projectiles = [];
export const projectilesGroup = new THREE.Group();

export let character, bodyMesh, headMesh, Larm, Rarm, Lleg, Rleg;
export let boxGeo, octGeo, bulletMat, loadedBullet = null;

const bulletGeo = new THREE.SphereGeometry(0.2,8,8);

export function initCharacter(myColor, sceneArg, renderer, isMobile){
  // store reference for use by helper functions like makeRemoteAvatar
  scene = sceneArg;

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

export function spawnLoadedBullet(){
  if(loadedBullet) return;
  loadedBullet = new THREE.Mesh(bulletGeo,bulletMat);
  loadedBullet.position.copy(headMesh.position);
  character.add(loadedBullet);
}

export function shootProjectile(){
  if(!loadedBullet) return;
  const c=currentCharge;
  const speedOut=THREE.MathUtils.lerp(MIN_SPEED_OUT,MAX_SPEED_OUT,c);
  const rangeOut=THREE.MathUtils.lerp(MIN_RANGE_OUT,MAX_RANGE_OUT,c);
  const craterR =THREE.MathUtils.lerp(MIN_CRATER,  MAX_CRATER,  c);
  loadedBullet.scale.setScalar(1); currentCharge=0;

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

export function teleport(){
  const x=(Math.random()-0.5)*GRID*SPAN, z=(Math.random()-0.5)*GRID*SPAN;
  const y=meshHeightAt(x,z)+1;
  character.position.set(x,y,z);
  vertVel=0; onGround=true;
}

export function ensureRemoteHasLoadedBullet(av,color){
  if(av.getObjectByName('loaded')) return;
  const ball=new THREE.Mesh(
    new THREE.SphereGeometry(0.2,8,8),
    new THREE.MeshStandardMaterial({ color })
  );
  ball.name='loaded'; ball.position.set(0,3.2,0);
  av.add(ball);
}

export function makeRemoteAvatar(col){
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

export function catchBoomerang(p){
  if(socket.readyState===1&&p.id!==undefined)
    socket.send(JSON.stringify({ t:'catch', shotId:p.id }));
  scene.remove(p.mesh);
  projectiles.splice(projectiles.indexOf(p),1);
  spawnLoadedBullet();
}

