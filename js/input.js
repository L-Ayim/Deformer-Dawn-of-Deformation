// js/input.js
import { shootProjectile } from './character.js';

export const move = { f:0, b:0, l:0, r:0 };

export function setupInput(renderer, state, isMobile){
  const { yawRef, pitchRef, spaceHeldRef, zHeldRef, shiftHeldRef, lastSpaceRef, lastZRef, teleport, loadedBulletRef, chargingRef, chargeStartRef, currentChargeRef, CHARGE_TIME_MAX } = state;

  if(isMobile){
    document.getElementById('joystick-zone').style.display = 'block';
    document.getElementById('joystick-look-zone').style.display = 'block';
    document.getElementById('shoot-button').style.display = 'block';
    document.getElementById('up-button').style.display = 'block';

    const joystick = nipplejs.create({
      zone: document.getElementById('joystick-zone'),
      mode: 'static',
      position: { left: '75px', bottom: '75px' },
      color: 'white',
      size: 100
    });

    joystick.on('move', (evt, data) => {
      const x = data.vector.x; const y = data.vector.y;
      move.f = y >  0.3 ? 1 : 0;
      move.b = y < -0.3 ? 1 : 0;
      move.l = x < -0.3 ? 1 : 0;
      move.r = x >  0.3 ? 1 : 0;
    });
    joystick.on('end', () => { move.f = move.b = move.l = move.r = 0; });

    const lookJoystick = nipplejs.create({
      zone: document.getElementById('joystick-look-zone'),
      mode: 'static',
      position: { right: '75px', top: '75px' },
      color: 'white',
      size: 80
    });
    lookJoystick.on('move', (evt, data) => {
      yawRef.value   -= data.vector.x * 0.05;
      pitchRef.value -= data.vector.y * 0.05;
      pitchRef.value = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, pitchRef.value));
    });

    const shootBtn = document.getElementById('shoot-button');
    shootBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!loadedBulletRef.value) return;
      chargingRef.value = true;
      chargeStartRef.value = performance.now();
    });
    shootBtn.addEventListener('touchend', e => {
      e.preventDefault();
      if (!chargingRef.value) return;
      chargingRef.value = false;
      currentChargeRef.value = Math.min(1, (performance.now() - chargeStartRef.value) / 1000 / CHARGE_TIME_MAX);
      shootProjectile();
    });

    const upBtn   = document.getElementById('up-button');
    const downBtn = document.getElementById('down-button');
    let lastUpTap = 0; let lastDownTap = 0;

    const onUpStart = () => {
      const now = performance.now();
      if (now - lastUpTap < 300) {
        state.flyModeRef.value = true;
        downBtn.style.display = 'block';
      } else if (!state.flyModeRef.value && state.onGroundRef.value) {
        state.vertVelRef.value = 12;
        state.onGroundRef.value = false;
      }
      lastUpTap = now;
      spaceHeldRef.value = true;
    };
    const onUpEnd = () => { spaceHeldRef.value = false; };
    upBtn.addEventListener('touchstart', e => { e.preventDefault(); onUpStart(); });
    upBtn.addEventListener('touchend',   e => { e.preventDefault(); onUpEnd(); });
    const onDownStart = () => {
      const now = performance.now();
      if (now - lastDownTap < 300) {
        state.flyModeRef.value = false;
        downBtn.style.display = 'none';
      }
      zHeldRef.value  = true;
      lastDownTap = now;
    };
    const onDownEnd = () => { zHeldRef.value  = false; };
    downBtn.addEventListener('touchstart', e => { e.preventDefault(); onDownStart(); });
    downBtn.addEventListener('touchend',   e => { e.preventDefault(); onDownEnd(); });
  }

  renderer.domElement.addEventListener('click',()=>
    renderer.domElement.requestPointerLock?.());
  document.addEventListener('pointerlockchange',()=>{
    if(document.pointerLockElement===renderer.domElement){
      document.addEventListener('mousemove',onMouseMove);
    }else document.removeEventListener('mousemove',onMouseMove);
  });
  function onMouseMove(e){
    const S=0.002; yawRef.value-=e.movementX*S; pitchRef.value+=e.movementY*S;
    pitchRef.value=Math.max(-Math.PI/4,Math.min(Math.PI/4,pitchRef.value));
  }
  document.addEventListener('keydown',e=>{
    if(e.repeat) return; const now=performance.now();
    switch(e.code){
      case'KeyW':move.f=1;break; case'KeyS':move.b=1;break;
      case'KeyA':move.l=1;break; case'KeyD':move.r=1;break;
      case'ShiftLeft':case'ShiftRight':shiftHeldRef.value=true;break;
      case'Space':
        spaceHeldRef.value=true;
        if(now-lastSpaceRef.value<300) state.flyModeRef.value=!state.flyModeRef.value;
        else if(state.onGroundRef.value&&!state.flyModeRef.value){ state.vertVelRef.value=12; state.onGroundRef.value=false; }
        lastSpaceRef.value=now; break;
      case'KeyZ':
        zHeldRef.value =true;
        if(state.flyModeRef.value&&now-lastZRef.value<300) state.flyModeRef.value=false;
        lastZRef.value=now; break;
      case'Escape':teleport();break;
    }
  });
  document.addEventListener('keyup',e=>{
    switch(e.code){
      case'KeyW':move.f=0;break; case'KeyS':move.b=0;break;
      case'KeyA':move.l=0;break; case'KeyD':move.r=0;break;
      case'ShiftLeft':case'ShiftRight':shiftHeldRef.value=false;break;
      case'Space':spaceHeldRef.value=false;break;
      case'KeyZ':zHeldRef.value =false;break;
    }
  });
}
