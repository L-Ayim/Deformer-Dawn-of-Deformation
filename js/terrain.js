// js/terrain.js

export const GRID = 300;
export const SPAN = 1;
export const HALF = GRID * SPAN / 2;
export const DEFORM_RADIUS = 1;
export const DEFORM_DEPTH = 3;
export const NOISE_SCALE = 0.002;
export const NOISE_AMP = 8;
export const NOISE_OCTS = 2;

export let hmImg;
let mapW, mapH, mapData, noise;
export let terrain;

export function loadHeightmap(mapSeed, onReady) {
  hmImg = new Image();
  hmImg.src = 'assets/heightmap.png';
  hmImg.onload = () => {
    mapW = hmImg.width; mapH = hmImg.height;
    const cv = document.createElement('canvas');
    cv.width = mapW; cv.height = mapH;
    const cx = cv.getContext('2d');
    cx.drawImage(hmImg,0,0);
    const raw = cx.getImageData(0,0,mapW,mapH).data;
    mapData = new Float32Array(mapW*mapH);
    for (let i=0;i<mapData.length;i++) mapData[i] = raw[i*4]/255;
    noise = new SimplexNoise(mapSeed);
    if (onReady) onReady();
  };
}

function getHeight(u,v){
  const x=((u%mapW)+mapW)%mapW, z=((v%mapH)+mapH)%mapH;
  const x0=Math.floor(x), z0=Math.floor(z),
        x1=(x0+1)%mapW,  z1=(z0+1)%mapH;
  const fx=x-x0, fz=z-z0;
  const i00=mapData[z0*mapW+x0], i10=mapData[z0*mapW+x1];
  const i01=mapData[z1*mapW+x0], i11=mapData[z1*mapW+x1];
  const ix0=i00*(1-fx)+i10*fx, ix1=i01*(1-fx)+i11*fx;
  return (ix0*(1-fz)+ix1*fz)*500;
}

function getNoise(u,v){
  let h=0, freq=NOISE_SCALE, amp=NOISE_AMP;
  for (let i=0;i<NOISE_OCTS;i++){
    h += noise.noise2D(u*freq,v*freq)*amp;
    freq*=2; amp*=0.5;
  }
  return h;
}

export function sampleHybridNormal(u,v){
  const e=1;
  const hL=getNoise(u-e,v), hR=getNoise(u+e,v);
  const hD=getNoise(u,v-e), hU=getNoise(u,v+e);
  return new THREE.Vector3(hL-hR,2*e,hD-hU).normalize();
}

export function initTerrain(scene){
  const size = GRID*SPAN;
  const geo  = new THREE.PlaneGeometry(size,size,GRID,GRID);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i)+size/2, z = pos.getZ(i)+size/2;
    const u = x/SPAN, v = z/SPAN;
    pos.setY(i, getHeight(u,v)+getNoise(u,v));
  }
  pos.needsUpdate=true;
  geo.computeVertexNormals();
  const textureLoader = new THREE.TextureLoader();
  const diffuseMap = textureLoader.load('assets/ruggeddiffused.png');

  const overlayMap = textureLoader.load('assets/ruggedpeaks.jpg');
  overlayMap.wrapS = overlayMap.wrapT = THREE.RepeatWrapping;
  overlayMap.repeat.set(GRID * SPAN / 256, GRID * SPAN / 256);
  geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array, 2));

  terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: diffuseMap,
      aoMap: overlayMap,
      aoMapIntensity: 1.5,
      metalness: 0.1,
      roughness: 0.9
    })
  );

  scene.add(terrain);
}

export function deformTerrain(impact,radius,depth){
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

export function meshHeightAt(x,z){
  const size=GRID*SPAN;
  const gx=Math.round((x+size/2)/SPAN);
  const gz=Math.round((z+size/2)/SPAN);
  const ix=THREE.MathUtils.clamp(gx,0,GRID);
  const iz=THREE.MathUtils.clamp(gz,0,GRID);
  const idx=iz*(GRID+1)+ix;
  return terrain.geometry.attributes.position.getY(idx);
}
