// server.js ───────────────────────────────────────────────
// Import dependencies
import { WebSocketServer } from 'ws';
import { v4 as uuid }      from 'uuid';
import os                  from 'os';

/* ─────────────── CONFIGURATION ───────────────────────── */
// Port to listen on
const PORT       = 3000;   
// Tick rate for server-side snapshot broadcast
const TICK_HZ    = 20;     
// How long (in seconds) a boomerang projectile lives
const BOOMER_TTL = 8;      
// Seed for terrain noise (client uses same seed)
const NOISE_SEED = 'sig-terrain-v1'; 
// Bounds for where targets can spawn
const TERRAIN_HALF  = 100;
const TARGET_RADIUS = 5;
const MAX_HEALTH    = 100;
const PROJECTILE_DAMAGE = 25;
// Base delay between terrain attacks (ms). Increased to lighten load
const TERRAIN_ATTACK_INTERVAL = 6000;
const TERRAIN_ATTACK_RADIUS   = 3;
const TERRAIN_SPIKE_DELAY     = 1000; // ms delay before damage applies
const TERRAIN_DAMAGE = 25;
// Fewer spikes per attack for smoother gameplay
const NUM_SPIKES_PER_ATTACK   = 8;

/* ────────────────── GLOBAL STATE ──────────────────────── */
// WebSocket server instance
const wss = new WebSocketServer({ port: PORT });
// Map of connected players: id → { input, state, color }
const players = new Map();
// Array of active boomerang projectiles
const projectiles = [];
// Running ID for each new shot
let nextShotId = 0;
// Current active target (or null if none)
let activeTarget = null;

/* ──────────── NAMED COLOR PALETTE ────────────────────── */
// A set of high-contrast color names
const PALETTE = [
  'white','black','red','orange','yellow','lime','green','teal',
  'cyan','blue','navy','purple','violet','magenta','pink','brown',
  'maroon','olive','gold','silver','gray'
];
// Track which have been used this session
const usedColors = new Set();
function pickNamedColour() {
  if (usedColors.size >= PALETTE.length) usedColors.clear();
  let name;
  do { 
    name = PALETTE[Math.random()*PALETTE.length|0]; 
  } while (usedColors.has(name));
  usedColors.add(name);
  return name;
}

/* ───────────── SERIALISE ONE SNAPSHOT ─────────────────── */
// Build the JSON payload sent each tick to all clients
function packSnapshot() {
  return JSON.stringify({
    t: 'snapshot',
    // players: id → { x,y,z,yaw,pitch,flyMode,color }
    players: Object.fromEntries(
      [...players.entries()].map(([id,p]) => [
        id,
        { ...p.state, color: p.color, health: p.health }
      ])
    ),
    // array of projectile records
    projectiles
  });
}

/* ───────────── TARGET SPAWNING & BROADCAST ───────────── */
// Create a new target somewhere in the world and notify all clients
function spawnTarget() {
  const id = uuid();
  const x  = (Math.random()*2 - 1) * TERRAIN_HALF;
  const z  = (Math.random()*2 - 1) * TERRAIN_HALF;
  activeTarget = { id, x, z };
  const msg = JSON.stringify({ t:'newTarget', target: activeTarget });
  wss.clients.forEach(c => c.readyState===1 && c.send(msg));
}
// First spawn in 2s, then every 30s
setTimeout(spawnTarget, 2000);
setInterval(spawnTarget, 30000);

function terrainAttack(){
  if(players.size===0) return;
  const spikes=[];
  const playerArr = [...players.values()];
  for(let i=0;i<NUM_SPIKES_PER_ATTACK;i++){
    let x,z;
    if(playerArr.length>0 && Math.random()<0.5){
      const p = playerArr[Math.random()*playerArr.length|0];
      x = p.state.x || 0;
      z = p.state.z || 0;
    }else{
      x=(Math.random()*2-1)*TERRAIN_HALF;
      z=(Math.random()*2-1)*TERRAIN_HALF;
    }
    const h=2+Math.random()*6;
    spikes.push({x,z,h});
    const msg=JSON.stringify({
      t:'terrainSpike', x, z, r:TERRAIN_ATTACK_RADIUS, delay:TERRAIN_SPIKE_DELAY, h
    });
    wss.clients.forEach(c=>c.readyState===1&&c.send(msg));
  }
  setTimeout(()=>{
    for(const [id,p] of players){
      for(const s of spikes){
        const dx=(p.state.x||0)-s.x;
        const dz=(p.state.z||0)-s.z;
        const dy=(p.state.y||0);
        if(Math.hypot(dx,dz)<=TERRAIN_ATTACK_RADIUS && dy<=s.h+2){
          p.health=Math.max(0,p.health-TERRAIN_DAMAGE);
          if(p.health<=0){
            wss.clients.forEach(c=>c.readyState===1&&c.send(JSON.stringify({t:'playerDied',id})));
            p.health=MAX_HEALTH;
          }
          break;
        }
      }
    }
  },TERRAIN_SPIKE_DELAY);
}
function scheduleTerrainAttack(){
  terrainAttack();
  const delay = TERRAIN_ATTACK_INTERVAL + Math.random()*TERRAIN_ATTACK_INTERVAL;
  setTimeout(scheduleTerrainAttack, delay);
}
setTimeout(scheduleTerrainAttack, TERRAIN_ATTACK_INTERVAL);

/* ─────────────── CLIENT CONNECTION ───────────────────── */
// Handle new WebSocket connections
wss.on('connection', ws => {
  // Assign this client a unique ID & color
  const id    = uuid();
  const color = pickNamedColour();

  // Initialize player state
  players.set(id, { input:{}, state:{}, color, health: MAX_HEALTH });

  // Send welcome packet with assigned ID, color, and noise seed
  ws.send(JSON.stringify({ t:'welcome', id, color, seed: NOISE_SEED }));

  // Handle incoming messages from this client
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {

      // Raw input (movement/keys) from client
      case 'input':
        players.get(id).input = msg.input;
        break;

      // Client's current pose/state
      case 'state':
        players.get(id).state = msg.state;
        break;

      // A new boomerang shot fired
      case 'shot': {
        const { x,y,z,dir,c } = msg.data;
        projectiles.push({
          id: nextShotId++,
          owner: id,
          x,y,z,dir,c,
          ttl: BOOMER_TTL
        });
        break;
      }

      // Client caught or despawned one of their own shots
      case 'catch': {
        const idx = projectiles.findIndex(p => p.id===msg.shotId);
        if (idx !== -1) projectiles.splice(idx,1);
        break;
      }

      // Terrain crater request: relay to everyone else
      case 'crater':
        wss.clients.forEach(c => {
          if (c!==ws && c.readyState===1)
            c.send(JSON.stringify({ t:'crater', crater: msg.crater }));
        });
        break;

      // Client reports hitting the active target
      case 'hitTarget': {
        if (activeTarget && msg.targetId === activeTarget.id) {
          const p = players.get(id);
          p.health = Math.min(MAX_HEALTH, p.health + 20);
          activeTarget = null;
          spawnTarget();
        }
        break;
      }

      case 'hitPlayer': {
        const target = players.get(msg.target);
        if (target) {
          const idx = projectiles.findIndex(p => p.id===msg.shotId);
          let mult = 1;
          if (idx !== -1) {
            const proj = projectiles[idx];
            mult = 1 + 2 * (proj.c ?? 0);
            projectiles.splice(idx,1);
          }
          const dmg = PROJECTILE_DAMAGE * mult;
          target.health = Math.max(0, target.health - dmg);
          if (target.health <= 0) {
            wss.clients.forEach(c => c.readyState===1 &&
              c.send(JSON.stringify({ t:'playerDied', id: msg.target })));
            target.health = MAX_HEALTH;
          }
        }
        break;
      }
    }
  });

  // Clean up when a client disconnects
  ws.on('close', () => {
    const p = players.get(id);
    if (p) usedColors.delete(p.color);
    players.delete(id);

    // Remove any projectiles belonging to them
    for (let i = projectiles.length-1; i>=0; i--) {
      if (projectiles[i].owner === id) projectiles.splice(i,1);
    }
  });
});

/* ──────────── FIXED-RATE BROADCAST TICK ──────────────── */
// Every (1000/TICK_HZ) ms, age projectiles and send a snapshot
setInterval(() => {
  const dt = 1 / TICK_HZ;
  // Remove expired projectiles
  for (let i = projectiles.length-1; i>=0; i--) {
    projectiles[i].ttl -= dt;
    if (projectiles[i].ttl <= 0) projectiles.splice(i,1);
  }
  // Broadcast world snapshot
  const packet = packSnapshot();
  wss.clients.forEach(c =>
    c.readyState===1 && c.send(packet)
  );
}, 1000 / TICK_HZ);

/* ───────────── UTILITY ───────────────────────────────── */
// Find first non-internal IPv4 address for logging
function firstIPv4() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const addr of iface ?? [])
      if (addr.family==='IPv4' && !addr.internal) return addr.address;
  }
  return '0.0.0.0';
}

// Log start-up info
console.log(`✅  Relay server running ▶ ws://${firstIPv4()}:${PORT}`);
