// js/network.js
import { deformTerrain, meshHeightAt } from './terrain.js';
import { ensureRemoteHasLoadedBullet, makeRemoteAvatar, projectiles, MIN_SCALE, MAX_SCALE, MIN_SPEED_OUT, MAX_SPEED_OUT, MIN_RANGE_OUT, MAX_RANGE_OUT, MIN_CRATER, MAX_CRATER, TTL_SECONDS } from './character.js';

export const host = location.hostname;
export const WS_URL = `ws://${host}:3000`;
export const socket = new WebSocket(WS_URL);
export const ghosts = new Map();
export const prevPos = new Map();
export const remoteShots = new Map();
export let myId = null;
export let myColor = new THREE.Color(0x222222);
export const scores = new Map();
export const names  = new Map();
export const colors = new Map();
export let myName = '';
export let activeTarget = null;

export function sendInput(input){
  if(socket.readyState===1 && myId){
    socket.send(JSON.stringify({ t:'input', input }));
  }
}

export function sendState(state){
  if(socket.readyState===1 && myId){
    socket.send(JSON.stringify({ t:'state', state }));
  }
}

export function setMyName(name){
  myName = name;
  if(myId && socket.readyState===1){
    socket.send(JSON.stringify({ t:'setName', name }));
  }
}

export function showHudMessage(text){
  const hud = document.getElementById('hud');
  if(!hud) return;
  hud.textContent = text;
  hud.style.opacity = '1';
  clearTimeout(showHudMessage._to);
  showHudMessage._to = setTimeout(()=>{ hud.style.opacity='0'; },2000);
}

export function updateScoreboard() {
  const ol = document.getElementById('leaderboard-list');
  ol.innerHTML = '';
  [...scores.entries()]
    .sort((a,b) => b[1] - a[1])
    .forEach(([id, pts]) => {
      const li = document.createElement('li');
      const name = id === myId ? (myName || 'You') : (names.get(id) || id);
      li.textContent = name + ': ' + pts;
      const col = colors.get(id);
      if(col) li.style.color = col;
      ol.appendChild(li);
    });
}

export function applySnapshot({ players:pack, projectiles:shots }, scene, bulletGeo){
  Object.keys(pack).forEach(id => {
    if (!scores.has(id)) scores.set(id, 0);
    if (pack[id].name) names.set(id, pack[id].name);
    if (pack[id].color) colors.set(id, pack[id].color);
  });
  updateScoreboard();

  for(const [id,st] of Object.entries(pack)){
    if(id===myId) continue;
    const av=ghosts.get(id) ?? makeRemoteAvatar(st.color);
    ghosts.set(id,av);
    colors.set(id, st.color);
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
    const swing=moved?Math.sin(performance.now()*0.01)*0.5:0;
    av.userData.Larm.rotation.x =  swing;
    av.userData.Rarm.rotation.x = -swing;
    av.userData.Lleg.rotation.x = -swing;
    av.userData.Rleg.rotation.x =  swing;
    prevPos.set(id,{x:st.x,z:st.z});
    av.visible=true;
  }
  ghosts.forEach((av,id)=>{ if(!(id in pack)) av.visible=false; });

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

export function setupNetwork(scene, bulletGeo, targetHandlers){
  socket.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    switch (msg.t) {
      case 'scoreUpdate': {
        Object.entries(msg.scores).forEach(([id, pts]) => { scores.set(id, pts); });
        updateScoreboard();
        if(msg.scorer){
          const name = msg.scorer === myId ? (myName||'You') : (names.get(msg.scorer) || msg.scorer);
          const pts  = scores.get(msg.scorer) || 0;
          showHudMessage(`${name} has ${pts} point${pts===1?'':'s'}`);
        }
        break;
      }
      case 'welcome':
        myId    = msg.id;
        myColor = new THREE.Color().setStyle(msg.color);
        colors.set(myId, msg.color);
        scores.set(myId, 0);
        names.set(myId, myName);
        if(socket.readyState===1) socket.send(JSON.stringify({ t:'setName', name: myName }));
        updateScoreboard();
        break;
      case 'nameUpdate':
        names.set(msg.id, msg.name);
        updateScoreboard();
        break;
      case 'snapshot':
        applySnapshot(msg, scene, bulletGeo);
        break;
      case 'newTarget': {
        activeTarget = msg.target;
        targetHandlers.spawn(msg.target);
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
}

