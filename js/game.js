// js/game.js - orchestrates game modules
import { loadHeightmap, initTerrain, terrain, meshHeightAt, HALF, GRID, SPAN, sampleHybridNormal, hmImg, deformTerrain } from './terrain.js';
import { initCharacter, character, headMesh, bodyMesh, Larm, Rarm, Lleg, Rleg, boxGeo, octGeo, projectiles, spawnLoadedBullet, catchBoomerang, loadedBullet, setAim, teleport } from './character.js';
import { setupNetwork, sendInput, sendState, socket, myId, activeTarget } from './network.js';
import { setupInput, move } from './input.js';

export function startGame(){
  const mapSeed = '🌎';
  const scene   = new THREE.Scene();
  let skyMesh;
  const camera  = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 100, 50);
  scene.add(ambient, dirLight);

  const renderer= new THREE.WebGLRenderer({ antialias:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio,1));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const miniCanvas = document.getElementById('minimap');
  const miniCtx    = miniCanvas.getContext('2d');
  const MM_SIZE    = 200;
  miniCanvas.width = MM_SIZE; miniCanvas.height = MM_SIZE;

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const TARGET_RADIUS = 5;

  const loader = new THREE.TextureLoader();
  loader.load('assets/star_sky.jpg', texture => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3,2);
    const geometry = new THREE.SphereGeometry(350, 64, 64);
    const material = new THREE.MeshBasicMaterial({ map:texture, side: THREE.BackSide });
    skyMesh = new THREE.Mesh(geometry, material);
    scene.add(skyMesh);
  });

  loadHeightmap(mapSeed, () => {
    initTerrain(scene);
    initCharacter(new THREE.Color(0x222222), scene, renderer, isMobile);
    let targetMesh = null;
    setupNetwork(scene, new THREE.SphereGeometry(0.2,8,8), {
      spawn(target){
        if(targetMesh){
          scene.remove(targetMesh);
          targetMesh.geometry.dispose();
          targetMesh.material.dispose();
        }
        const height = meshHeightAt(target.x, target.z);
        const geom   = new THREE.CylinderGeometry(0.5,0.5, 3, 8);
        const mat    = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        targetMesh   = new THREE.Mesh(geom, mat);
        targetMesh.position.set(target.x, height + 1.5, target.z);
        scene.add(targetMesh);
      }
    });

      const state = {
        yawRef:{value:0}, pitchRef:{value:0},
        spaceHeldRef:{value:false}, zHeldRef:{value:false}, shiftHeldRef:{value:false},
        lastSpaceRef:{value:0}, lastZRef:{value:0},
        flyModeRef:{value:false}, onGroundRef:{value:false}, vertVelRef:{value:0},
        loadedBulletRef:{value:null}, chargingRef:{value:false},
        chargeStartRef:{value:0}, currentChargeRef:{value:0},
        teleport, CHARGE_TIME_MAX:1.5
      };
    setupInput(renderer, state, isMobile);

    const CLOCK = new THREE.Clock();
    let lastFrame = 0;

    function animate(){
      requestAnimationFrame(animate);
      const now = performance.now();
      if(now - lastFrame < 1000/60) return;
      lastFrame = now;
      const dt = Math.min(CLOCK.getDelta(), 0.05);

      setAim(state.yawRef.value, state.pitchRef.value);

      sendInput({ move, spaceHeld: state.spaceHeldRef.value,
                  zHeld: state.zHeldRef.value, shiftHeld: state.shiftHeldRef.value });

      if(socket.readyState===1 && myId){
        sendState({ x: character.position.x, y: character.position.y,
                    z: character.position.z, yaw: state.yawRef.value,
                    pitch: state.pitchRef.value, flyMode: state.flyModeRef.value });
      }

      if(state.chargingRef.value && loadedBullet){
        const held = (performance.now()-state.chargeStartRef.value)/1000;
        state.currentChargeRef.value = Math.min(1, held/1.5);
        const s = THREE.MathUtils.lerp(1, 3, state.currentChargeRef.value);
        loadedBullet.scale.setScalar(s);
      }

      for(let i=projectiles.length-1;i>=0;i--){
        const p=projectiles[i]; p.ttl-=dt;
        const dist=p.mesh.position.distanceTo(character.position);
        if(p.ttl<=0||dist>300){
          scene.remove(p.mesh); projectiles.splice(i,1); spawnLoadedBullet(); continue;
        }
        const step=p.velocity.clone().multiplyScalar(dt);
        p.mesh.position.add(step); p.travelled+=step.length();
        const groundY=meshHeightAt(p.mesh.position.x,p.mesh.position.z);
        const hitGround=p.mesh.position.y<=groundY;
        if(hitGround){
          if(hitGround && activeTarget){
            const dx=p.mesh.position.x-activeTarget.x;
            const dz=p.mesh.position.z-activeTarget.z;
            if(Math.hypot(dx,dz)<=TARGET_RADIUS){
              socket.send(JSON.stringify({t:'hitTarget', targetId:activeTarget.id}));
              activeTarget=null;
            }
          }
          deformTerrain(p.mesh.position.clone(),p.craterRad,3);
          if(socket.readyState===1 && myId){
            const c=p.mesh.position.clone();
            socket.send(JSON.stringify({ t:'crater', crater:{x:c.x,z:c.z,r:p.craterRad,d:3} }));
          }
          p.mesh.position.y=groundY+0.3;
        }
        if(!p.returning&&(hitGround||p.travelled>=p.maxRange)) p.returning=true;
        if(p.returning){
          const headPos=headMesh.getWorldPosition(new THREE.Vector3());
          const toHead=headPos.clone().sub(p.mesh.position);
          const distH=toHead.length(); const stepLen=120*dt;
          if(distH<=0.6||distH<=stepLen){
            catchBoomerang(p);
            continue;
          }
          p.velocity.copy(toHead.normalize().multiplyScalar(120));
        }
      }

      const dir=new THREE.Vector3(move.r-move.l,0,move.b-move.f);
      if(dir.lengthSq()){
        dir.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),state.yawRef.value);
        const baseSpeed=state.flyModeRef.value?20:10;
        character.position.addScaledVector(dir, baseSpeed*(state.shiftHeldRef.value?2:1)*dt);
      }

      if(state.flyModeRef.value){
        if(state.spaceHeldRef.value) character.position.y+=20*dt;
        if(state.zHeldRef.value) character.position.y-=20*dt;
        const gY=meshHeightAt(character.position.x,character.position.z)+2;
        if(character.position.y<=gY){ character.position.y=gY; state.flyModeRef.value=false; state.onGroundRef.value=true; state.vertVelRef.value=0; }
      }else{
        state.vertVelRef.value-=30*dt; character.position.y+=state.vertVelRef.value*dt;
        const gY=meshHeightAt(character.position.x,character.position.z)+2;
        if(character.position.y<=gY){ character.position.y=gY; state.vertVelRef.value=0; state.onGroundRef.value=true; }
      }

      if(Math.abs(character.position.x)>HALF||Math.abs(character.position.z)>HALF) teleport();

      if(!state.flyModeRef.value){
        const u=(character.position.x+HALF)/SPAN,v=(character.position.z+HALF)/SPAN;
        const n=sampleHybridNormal(u,v), up=new THREE.Vector3(0,1,0);
        let angle=Math.acos(THREE.MathUtils.clamp(n.dot(up),-1,1));
        angle=Math.min(angle,THREE.MathUtils.degToRad(5));
        const axis=new THREE.Vector3().crossVectors(up,n).normalize();
        const q=new THREE.Quaternion().setFromAxisAngle(axis,angle);
        const sUp=up.clone().applyQuaternion(q).normalize();
        character.up.copy(sUp);
        const sq=new THREE.Quaternion().setFromUnitVectors(up,sUp);
        const fwd=new THREE.Vector3(Math.sin(state.yawRef.value),0,Math.cos(state.yawRef.value)).applyQuaternion(sq);
        character.lookAt(character.position.clone().add(fwd));
      }else{
        character.up.set(0,1,0);
        const fwd=new THREE.Vector3(Math.sin(state.yawRef.value),0,Math.cos(state.yawRef.value));
        character.lookAt(character.position.clone().add(fwd));
      }

      const walking=dir.lengthSq()>0&&!state.flyModeRef.value;
      if(walking){
        const swing=Math.sin(performance.now()*0.01*10)*0.5;
        Larm.rotation.x=swing; Rarm.rotation.x=-swing;
        Lleg.rotation.x=-swing; Rleg.rotation.x=swing;
      }else{
        Larm.rotation.x=Rarm.rotation.x=Lleg.rotation.x=Rleg.rotation.x=0;
      }

      const Rcam=8;
      const camOff=new THREE.Vector3(
        Rcam*Math.sin(state.yawRef.value)*Math.cos(state.pitchRef.value),
        Rcam*Math.sin(state.pitchRef.value)+3,
        Rcam*Math.cos(state.yawRef.value)*Math.cos(state.pitchRef.value)
      );
      camera.position.copy(character.position).add(camOff);
      camera.lookAt(character.position);

      if(socket.readyState===1 && myId){
        sendState({ x:character.position.x, y:character.position.y, z:character.position.z,
                    yaw:state.yawRef.value, pitch:state.pitchRef.value, flyMode:state.flyModeRef.value });
      }

      if(skyMesh) skyMesh.position.copy(camera.position);

      renderer.render(scene,camera);

      miniCtx.clearRect(0,0,MM_SIZE,MM_SIZE);
      miniCtx.globalAlpha=0.4;
      miniCtx.drawImage(hmImg,0,0,MM_SIZE,MM_SIZE);
      miniCtx.globalAlpha=1;
      const xN=(character.position.x+HALF)/(GRID*SPAN);
      const zN=(character.position.z+HALF)/(GRID*SPAN);
      const px=xN*MM_SIZE, py=(1-zN)*MM_SIZE;
      miniCtx.fillStyle='#f00';
      miniCtx.beginPath(); miniCtx.arc(px,py,5,0,Math.PI*2); miniCtx.fill();
      miniCtx.fillStyle='#fff'; miniCtx.fillRect(px-5,py-5,10,10);
      miniCtx.save(); miniCtx.globalAlpha=0.2;
      miniCtx.fillStyle='#fff';
      miniCtx.beginPath();
      miniCtx.moveTo(MM_SIZE/2,8);
      miniCtx.lineTo(MM_SIZE/2+6,22);
      miniCtx.lineTo(MM_SIZE/2-6,22);
      miniCtx.closePath(); miniCtx.fill();
      miniCtx.font='12px sans-serif'; miniCtx.textAlign='center';
      miniCtx.fillText('N',MM_SIZE/2,36); miniCtx.restore();
      if(activeTarget){
        const tx=(activeTarget.x+HALF)/(GRID*SPAN)*MM_SIZE;
        const tz=(1-(activeTarget.z+HALF)/(GRID*SPAN))*MM_SIZE;
        miniCtx.fillStyle='#ff0';
        miniCtx.beginPath();
        miniCtx.arc(tx,tz,6,0,Math.PI*2);
        miniCtx.fill();
      }
    }
    animate();
  });
}
