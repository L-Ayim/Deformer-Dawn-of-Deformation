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
// Random spikes occur roughly five times per minute while
// player-targeted spikes happen about once per minute.
const RANDOM_ATTACK_INTERVAL   = 60000 / 5;  // 5 per minute
const TARGETED_ATTACK_INTERVAL = 120000 / 2; // 2 per two minutes
const TERRAIN_ATTACK_RADIUS    = 3;
const TERRAIN_SPIKE_DELAY      = 1000; // ms delay before damage applies
const TERRAIN_DAMAGE           = 25;
// Fewer spikes per attack for smoother gameplay
const NUM_SPIKES_PER_ATTACK    = 2;
// Toggle to completely disable terrain spike attacks
const TERRAIN_ATTACKS_ENABLED  = false;

// Power-up configuration
const POWERUP_COUNTS = {
  health: 10,
  double: 5,
  shield: 5,
  speed: 5
};
const SHIELD_DURATION = 10; // seconds
const SPEED_DURATION  = 10; // seconds
const DOUBLE_SHOTS    = 10; // number of double shots
const START_LIVES     = 5;  // lives per player

/* ────────────────── GLOBAL STATE ──────────────────────── */
// WebSocket server instance
const wss = new WebSocketServer({ port: PORT });
// Map of connected players: id → { input, state, color }
const players = new Map();
// Array of active boomerang projectiles
const projectiles = [];
// Running ID for each new shot
let nextShotId = 0;
// Power-ups present in the world
let powerups = [];

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
    players: Object.fromEntries(
      [...players.entries()].map(([id,p]) => [
        id,
        {
          ...p.state,
          color: p.color,
          health: p.health,
          shield: p.shield || 0,
          speed: p.speed || 0,
          double: p.doubleShots || 0,
          lives: p.lives
        }
      ])
    ),
    projectiles,
    powerups
  });
}

/* ───────────── POWER-UP SPAWNING ───────────── */
function spawnInitialPowerups(){
  powerups = [];
  for(const [type,count] of Object.entries(POWERUP_COUNTS)){
    for(let i=0;i<count;i++){
      powerups.push({
        id: uuid(),
        type,
        x: (Math.random()*2-1)*TERRAIN_HALF,
        z: (Math.random()*2-1)*TERRAIN_HALF
      });
    }
  }
}
// Spawn once on startup
spawnInitialPowerups();

function sendSpike(x, z, h){
  const msg = JSON.stringify({
    t: 'terrainSpike',
    x, z,
    r: TERRAIN_ATTACK_RADIUS,
    delay: TERRAIN_SPIKE_DELAY,
    h
  });
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

function applySpikeDamage(spikes){
  setTimeout(() => {
    for(const [id,p] of players){
      for(const s of spikes){
        const dx=(p.state.x||0)-s.x;
        const dz=(p.state.z||0)-s.z;
        const dy=(p.state.y||0);
        if(Math.hypot(dx,dz)<=TERRAIN_ATTACK_RADIUS && dy<=s.h+2){
          if(p.shield>0) break;
          p.health=Math.max(0,p.health-TERRAIN_DAMAGE);
          if(p.health<=0){
            p.lives -= 1;
            if(p.lives>0){
              wss.clients.forEach(c=>c.readyState===1&&c.send(JSON.stringify({t:'playerDied',id})));
              p.health=MAX_HEALTH;
            } else {
              wss.clients.forEach(c=>c.readyState===1&&c.send(JSON.stringify({t:'playerOut',id})));
              usedColors.delete(p.color);
              players.delete(id);
              break;
            }
          }
          break;
        }
      }
    }
  }, TERRAIN_SPIKE_DELAY);
}

function randomTerrainAttack(){
  if(players.size===0) return;
  const spikes=[];
  for(let i=0;i<NUM_SPIKES_PER_ATTACK;i++){
    const x=(Math.random()*2-1)*TERRAIN_HALF;
    const z=(Math.random()*2-1)*TERRAIN_HALF;
    const h=2+Math.random()*6;
    spikes.push({x,z,h});
    sendSpike(x,z,h);
  }
  applySpikeDamage(spikes);
}

function targetedTerrainAttack(){
  if(players.size===0) return;
  const playerArr=[...players.values()];
  const target=playerArr[Math.random()*playerArr.length|0];
  const spikes=[];
  for(let i=0;i<NUM_SPIKES_PER_ATTACK;i++){
    const x=target.state.x||0;
    const z=target.state.z||0;
    const h=2+Math.random()*6;
    spikes.push({x,z,h});
    sendSpike(x,z,h);
  }
  applySpikeDamage(spikes);
}

if (TERRAIN_ATTACKS_ENABLED) {
  setInterval(randomTerrainAttack, RANDOM_ATTACK_INTERVAL);
  setInterval(targetedTerrainAttack, TARGETED_ATTACK_INTERVAL);
}

/* ─────────────── CLIENT CONNECTION ───────────────────── */
// Handle new WebSocket connections
wss.on('connection', ws => {
  // Assign this client a unique ID & color
  const id    = uuid();
  const color = pickNamedColour();

  // Initialize player state
  players.set(id, {
    input:{},
    state:{},
    color,
    health: MAX_HEALTH,
    shield: 0,
    speed: 0,
    doubleShots: 0,
    lives: START_LIVES
  });

  // Send welcome packet with assigned ID, color, and noise seed
  ws.send(JSON.stringify({ t:'welcome', id, color, seed: NOISE_SEED }));

  // Handle incoming messages from this client
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {

      // Raw input (movement/keys) from client
      case 'input':
        if (players.has(id)) players.get(id).input = msg.input;
        break;

      // Client's current pose/state
      case 'state':
        if (players.has(id)) players.get(id).state = msg.state;
        break;

      // A new boomerang shot fired
      case 'shot': {
        if (!players.has(id)) break;
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
        if (!players.has(id)) break;
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

      // Client reports picking up a power-up
      case 'pickup': {
        if (!players.has(id)) break;
        const idx = powerups.findIndex(pu => pu.id === msg.powerupId);
        if (idx !== -1) {
          const item = powerups[idx];
          powerups.splice(idx,1);
          const p = players.get(id);
          switch(item.type){
            case 'health':
              p.health = Math.min(MAX_HEALTH, p.health + 20);
              break;
            case 'double':
              p.doubleShots = DOUBLE_SHOTS;
              break;
            case 'shield':
              p.shield = SHIELD_DURATION;
              break;
            case 'speed':
              p.speed = SPEED_DURATION;
              break;
          }
        }
        break;
      }

      case 'hitPlayer': {
        if (!players.has(id)) break;
        const target = players.get(msg.target);
        if (target) {
          if (target.shield > 0) break;
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
            target.lives -= 1;
            if (target.lives > 0) {
              wss.clients.forEach(c => c.readyState===1 &&
                c.send(JSON.stringify({ t:'playerDied', id: msg.target })));
              target.health = MAX_HEALTH;
            } else {
              wss.clients.forEach(c => c.readyState===1 &&
                c.send(JSON.stringify({ t:'playerOut', id: msg.target })));
              usedColors.delete(target.color);
              players.delete(msg.target);
            }
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
  // Update player effect timers
  for(const p of players.values()){
    if(p.shield>0) p.shield = Math.max(0, p.shield - dt);
    if(p.speed>0) p.speed = Math.max(0, p.speed - dt);
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
