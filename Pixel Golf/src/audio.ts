import { engine, Entity, Transform, AudioSource } from '@dcl/sdk/ecs'
import { myBay } from './ledger/client'

// The player's sound settings: background music and the commentator (voice.ts), each with an
// on/off switch and a volume of 1 to 10 steps, set in the Settings panel and saved on the ledger.
//
// The ledger stores settings as on/off switches only, so a volume is saved as one switch per step
// (musicVol1 .. musicVol10), the same way the shot speed is: the step that's on is the volume.

export const VOLUME_STEPS = 10

export const audio = {
  musicOn: true,
  musicVol: 4,
  voiceOn: true,
  voiceVol: 8
}

/** The music track, in assets/sounds/music/ */
const MUSIC_CLIP = 'assets/sounds/music/background.mp3'
/** The loudest the music gets at full volume, so it sits under the game's sounds */
const MUSIC_MAX = 0.6

let music: Entity | null = null

function applyMusic(): void {
  if (!music) {
    music = engine.addEntity()
    Transform.create(music, {})
  }
  AudioSource.createOrReplace(music, {
    audioClipUrl: MUSIC_CLIP,
    playing: audio.musicOn,
    loop: true,
    global: true,
    volume: (audio.musicVol / VOLUME_STEPS) * MUSIC_MAX
  })
}

/**
 * The pigeons' coos, looping quietly where the pigeons stand (Pidgeon Animation V4.glb, by bay 20).
 * Not global, so it fades out as you walk away and you only hear it near them. Muted while you're
 * in a bay (playing, the solo bay or the tutorial), so it doesn't talk over your round.
 */
const PIGEON_CLIP = 'assets/sounds/pigeons.mp3'
const PIGEON_AT = { x: 107.29, y: 33.4, z: 162.26 }
const PIGEON_VOLUME = 0.425

function setupPigeonSound(): void {
  const e = engine.addEntity()
  Transform.create(e, { position: PIGEON_AT })
  // Stopped outright while muted (turning the volume down on a playing loop wasn't heard), and
  // started again from the top when you leave the bay
  const set = (on: boolean) =>
    AudioSource.createOrReplace(e, { audioClipUrl: PIGEON_CLIP, playing: on, loop: true, global: false, volume: on ? PIGEON_VOLUME : 0, currentTime: 0 })
  let muted = myBay() !== 0
  set(!muted)
  engine.addSystem(() => {
    const mute = myBay() !== 0
    if (mute === muted) return
    muted = mute
    set(!mute)
  })
}

/** Starts the music and the pigeons (call once when the scene loads). */
export function setupMusic(): void {
  applyMusic()
  setupPigeonSound()
}

/** 0 to 1: how loud the commentator should be right now (0 when switched off) */
export function voiceLevel(): number {
  return audio.voiceOn ? audio.voiceVol / VOLUME_STEPS : 0
}

// Saving: index.ts passes saveSetting in here
const saveFns: ((key: string, on: boolean) => void)[] = []
export function onAudioSettingChanged(fn: (key: string, on: boolean) => void): void {
  saveFns.push(fn)
}
function save(key: string, on: boolean): void {
  for (const fn of saveFns) fn(key, on)
}

function clampStep(n: number): number {
  return Math.max(1, Math.min(VOLUME_STEPS, Math.round(n)))
}

export function toggleMusic(): void {
  audio.musicOn = !audio.musicOn
  applyMusic()
  save('music', audio.musicOn)
}

export function setMusicVolume(step: number): void {
  const s = clampStep(step)
  if (s === audio.musicVol) return
  save('musicVol' + audio.musicVol, false)
  audio.musicVol = s
  save('musicVol' + s, true)
  // Moving the slider switches the music back on
  if (!audio.musicOn) toggleMusic()
  else applyMusic()
}

export function toggleVoice(): void {
  audio.voiceOn = !audio.voiceOn
  save('voice', audio.voiceOn)
}

export function setVoiceVolume(step: number): void {
  const s = clampStep(step)
  if (s === audio.voiceVol) return
  save('voiceVol' + audio.voiceVol, false)
  audio.voiceVol = s
  save('voiceVol' + s, true)
  if (!audio.voiceOn) toggleVoice()
}

function savedStep(saved: Record<string, boolean>, prefix: string): number {
  for (let i = 1; i <= VOLUME_STEPS; i++) if (saved[prefix + i] === true) return i
  return 0
}

/** The switches saved on the ledger from last time. Sets them without saving them again. */
export function applySavedAudio(saved: Record<string, boolean>): void {
  if (typeof saved.music === 'boolean') audio.musicOn = saved.music
  if (typeof saved.voice === 'boolean') audio.voiceOn = saved.voice
  const m = savedStep(saved, 'musicVol')
  if (m) audio.musicVol = m
  const v = savedStep(saved, 'voiceVol')
  if (v) audio.voiceVol = v
  applyMusic()
}
