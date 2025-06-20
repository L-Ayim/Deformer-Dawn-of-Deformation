// js/game.js - orchestrates game modules
import { loadHeightmap, initTerrain, terrain, meshHeightAt, HALF } from './terrain.js';
import { initCharacter, character, shootProjectile, spawnLoadedBullet, projectiles } from './character.js';
import { setupNetwork, socket, myId } from './network.js';
import { setupInput, move } from './input.js';

export function startGame(){
  const mapSeed = '🌎';
  const scene   = new THREE.Scene();
  const camera  = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);
  const renderer= new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  loadHeightmap(mapSeed, () => {
    initTerrain(scene);
    initCharacter(new THREE.Color(0x222222), scene, renderer, isMobile);
    setupNetwork(scene, new THREE.SphereGeometry(0.2,8,8), {
      spawn(target){
        const height = meshHeightAt(target.x, target.z);
        const geom   = new THREE.CylinderGeometry(0.5,0.5, 3, 8);
        const mat    = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        const marker = new THREE.Mesh(geom, mat);
        marker.position.set(target.x, height + 1.5, target.z);
        scene.add(marker);
      }
    });

    const state = {
      yawRef:{value:0}, pitchRef:{value:0},
      spaceHeldRef:{value:false}, zHeldRef:{value:false}, shiftHeldRef:{value:false},
      lastSpaceRef:{value:0}, lastZRef:{value:0},
      flyModeRef:{value:false}, onGroundRef:{value:false}, vertVelRef:{value:0},
      loadedBulletRef:{value:null}, chargingRef:{value:false},
      chargeStartRef:{value:0}, currentChargeRef:{value:0},
      teleport(){}, CHARGE_TIME_MAX:1.5
    };
    setupInput(renderer, state, isMobile);

    function animate(){
      requestAnimationFrame(animate);
      renderer.render(scene,camera);
    }
    animate();
  });
}
