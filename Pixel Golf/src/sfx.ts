import { engine, Entity, Transform, AudioSource } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

// Sound effects. The clips are in assets/sounds/.
//
//   playUi(name)            heard the same wherever you are: menus, meters, score jingles
//   playAt(name, position)  comes from a point in the world: club strikes, landings

export type Sfx =
  | 'club_hit'
  | 'swing_whoosh'
  | 'ball_land'
  | 'bunker_sand'
  | 'meter_lock'
  | 'tee_off'
  | 'score_small'
  | 'score_good'
  | 'score_great'
  | 'score_miss'
  | 'ui_click'
  | 'ui_select'
  | 'ui_open'
  | 'ui_close'

const SOUND_DIR = 'assets/sounds/'

// Overall loudness of each sound, 0 to 1. Tune these by ear.
const VOLUME: Record<Sfx, number> = {
  club_hit: 1,
  swing_whoosh: 0.6,
  ball_land: 0.8,
  bunker_sand: 0.9,
  meter_lock: 0.5,
  tee_off: 0.6,
  score_small: 0.7,
  score_good: 0.8,
  score_great: 0.9,
  score_miss: 0.6,
  ui_click: 0.45,
  ui_select: 0.5,
  ui_open: 0.45,
  ui_close: 0.45
}

// A few sources of each kind, used in turn, so sounds can overlap
const POOL_SIZE = 6
const uiPool: Entity[] = []
const worldPool: Entity[] = []
let uiNext = 0
let worldNext = 0

function nextSource(global: boolean): Entity {
  const pool = global ? uiPool : worldPool
  if (pool.length < POOL_SIZE) {
    const e = engine.addEntity()
    Transform.create(e, {})
    pool.push(e)
    return e
  }
  if (global) {
    uiNext = (uiNext + 1) % POOL_SIZE
    return pool[uiNext]
  }
  worldNext = (worldNext + 1) % POOL_SIZE
  return pool[worldNext]
}

function play(e: Entity, name: Sfx, global: boolean, volume: number, pitch: number): void {
  AudioSource.createOrReplace(e, {
    audioClipUrl: SOUND_DIR + name + '.mp3',
    playing: true,
    loop: false,
    global,
    volume: Math.max(0, Math.min(1, VOLUME[name] * volume)),
    pitch,
    currentTime: 0
  })
}

/** A sound heard the same wherever the player is (menus, meters, score jingles). */
export function playUi(name: Sfx, volume = 1, pitch = 1): void {
  play(nextSource(true), name, true, volume, pitch)
}

/** A sound that comes from a point in the world (club strikes, landings). */
export function playAt(name: Sfx, position: { x: number; y: number; z: number }, volume = 1, pitch = 1): void {
  const e = nextSource(false)
  Transform.getMutable(e).position = Vector3.create(position.x, position.y, position.z)
  play(e, name, false, volume, pitch)
}
