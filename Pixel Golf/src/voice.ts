import { engine, Entity, Transform, AudioSource } from '@dcl/sdk/ecs'
import { voiceLevel } from './audio'

// The commentator: short voice lines for your own shots. The clips are in assets/sounds/vo/.
// Only you hear the lines for your shots (they're played from your own game, not shared).
// One line at a time: a new line cuts off the one before. A line never plays twice in a row.
//
//   great   any target hit
//   big     the hot target, or one of the hardest targets (White, Black)
//   miss    no target, a bunker, or off the range

export type VoiceMoment = 'great' | 'big' | 'miss'

const VO_DIR = 'assets/sounds/vo/'

const LINES: Record<VoiceMoment, string[]> = {
  great: ['great_1', 'great_2', 'whatashot_1', 'whatashot_2', 'whatashot_3'],
  big: ['unbelievable', 'betyoucouldnt', 'whatashot_1', 'whatashot_3'],
  // getinthehole says "Maybe try getting it in the hole", so it's a miss taunt
  miss: ['miss_1', 'miss_2', 'miss_3', 'taunt_1', 'taunt_2', 'getinthehole']
}

/** In the tutorial, a miss only gets "That's a miss", never a taunt */
const KIND_MISS = ['miss_1', 'miss_2', 'miss_3']

/** How often each moment gets a line, 0 to 1. Tune these to taste. */
const CHANCE: Record<VoiceMoment, number> = {
  great: 1,
  big: 1,
  miss: 1
}

/** Seconds after the moment before the line starts, so it follows the score jingle or the strike */
const DELAY: Record<VoiceMoment, number> = {
  great: 0.35,
  big: 0.35,
  miss: 0.3
}

const VOLUME = 0.85

let source: Entity | null = null
let last = ''
let pending: { clip: string; at: number } | null = null
let clock = 0

function voiceSource(): Entity {
  if (!source) {
    source = engine.addEntity()
    Transform.create(source, {})
    engine.addSystem((dt) => {
      clock += dt
      if (pending && clock >= pending.at) {
        const clip = pending.clip
        pending = null
        const level = voiceLevel()
        if (level <= 0) return
        AudioSource.createOrReplace(voiceSource(), {
          audioClipUrl: VO_DIR + clip + '.mp3',
          playing: true,
          loop: false,
          global: true,
          volume: VOLUME * level,
          currentTime: 0
        })
      }
    })
  }
  return source
}

/** Plays a voice line for a moment (if the dice say so). `gentle` drops the taunts, for the tutorial. */
export function sayLine(moment: VoiceMoment, gentle = false): void {
  // Commentary switched off in Settings
  if (voiceLevel() <= 0) return
  if (Math.random() >= CHANCE[moment]) return
  let pool = moment === 'miss' && gentle ? KIND_MISS : LINES[moment]
  if (pool.length > 1) pool = pool.filter((c) => c !== last)
  const clip = pool[Math.floor(Math.random() * pool.length)]
  last = clip
  voiceSource()
  pending = { clip, at: clock + DELAY[moment] }
}
