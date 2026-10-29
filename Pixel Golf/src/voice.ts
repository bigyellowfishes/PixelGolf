import { engine, Entity, Transform, AudioSource } from '@dcl/sdk/ecs'
import { voiceLevel } from './audio'

// The commentator: short voice lines for your own game. The clips are in assets/sounds/vo/.
// Only you hear them (they're played from your own game, not shared).
//
// One line at a time. A line is only cut off by a more important one (see PRIORITY); a line of the
// same or lower importance that comes up while another is playing is skipped, unless it's asked
// for with `queue`, in which case it waits its turn (the end of a round: the last ball's line, then
// "Round done!", then the personal best or the multiplier). A line never plays twice in a row.
//
// Where each moment is said:
//   game.ts        the shot: wait, strike, flight, wind, roll, speed, the result lines, last ball,
//                  idle, abandon
//   commentary.ts  everything else: walking into a bay, the crowd, the shop, the tutorial,
//                  the end of a round and what the ledger made of it

export type VoiceMoment =
  // Where a shot finished
  | 'great' // any target (the generic lines)
  | 'big' // the hot target or one of the hardest targets (generic lines)
  | 'red'
  | 'yellow'
  | 'green'
  | 'orange'
  | 'blue'
  | 'white'
  | 'black'
  | 'hot' // the hot target (2x)
  | 'bunker'
  | 'miss' // no target
  | 'out' // off the range
  | 'tutMiss' // a miss in the tutorial: kind, and it doesn't count
  // During a shot
  | 'wait' // taking ages to set the power or curve
  | 'strike' // the ball leaves
  | 'flight' // a long time in the air
  | 'windHelp' // a strong wind behind the shot
  | 'windAgainst' // a strong wind into the shot
  | 'windAcross' // a strong crosswind
  | 'roll' // still rolling a long time after landing
  | 'speed' // shot speed turned up to 3x
  // Round
  | 'last' // the last ball of a round
  | 'round' // round done
  | 'pb' // personal best
  | 'multiMid' // a roll above the crowd minimum
  | 'multiBig' // a big roll
  | 'abandon'
  // Around the range
  | 'bay' // walking into a bay
  | 'crowd' // walking into a bay with a crowd in (enough players to lift the multiplier)
  | 'idle' // standing in your bay doing nothing
  | 'shopOpen'
  | 'shopBall' // equipped a new ball in the shop
  | 'tutStart'
  | 'tutDone'

const VO_DIR = 'assets/sounds/vo/'

const LINES: Record<VoiceMoment, string[]> = {
  great: ['great_1', 'great_2', 'whatashot_1', 'whatashot_2', 'whatashot_3'],
  big: ['unbelievable', 'betyoucouldnt', 'whatashot_1', 'whatashot_3'],
  red: ['target_red'],
  yellow: ['target_yellow'],
  green: ['target_green'],
  orange: ['target_orange'],
  blue: ['target_blue'],
  white: ['target_white'],
  black: ['target_black'],
  hot: ['hot_smug', 'hot_card', 'hot_fire', 'hot_dance', 'unbelievable'],
  bunker: ['bunker_bunker', 'bunker_sand', 'bunker_beach', 'bunker_castles', 'bunker_shoes'],
  // getinthehole says "Maybe try getting it in the hole", so it's a miss taunt
  miss: [
    'miss_1', 'miss_2', 'miss_3', 'taunt_1', 'taunt_2', 'getinthehole',
    'miss_notatarget', 'miss_bold', 'miss_overthere', 'miss_somewhere', 'miss_seenbetter'
  ],
  out: ['out_building', 'out_bounds', 'out_garden', 'out_gone', 'out_postcode'],
  // In the tutorial a miss only gets "That's a miss" or "doesn't count", never a taunt
  tutMiss: ['miss_1', 'miss_2', 'miss_3', 'tut_miss'],

  wait: ['wait_anytime', 'wait_pose', 'wait_hititself', 'wait_eternity'],
  strike: ['strike_welly', 'strike_clean', 'strike_places', 'strike_smashed'],
  flight: ['flight_upup', 'flight_airtraffic', 'flight_flyer', 'flight_lunch'],
  windHelp: ['wind_assisted', 'wind_say'],
  windAgainst: ['wind_against', 'wind_say', 'wind_crisp'],
  windAcross: ['wind_crisp', 'wind_say'],
  roll: ['roll_committed', 'roll_tour', 'roll_fella', 'roll_tuesday'],
  speed: ['speed_train', 'speed_respect'],

  last: ['last_pressure', 'last_final'],
  round: ['round_damage', 'round_sitdown', 'round_words'],
  pb: ['pb_fridge', 'pb_new', 'pb_bestyet'],
  multiMid: ['multi_notbad', 'multi_crowd'],
  multiBig: ['multi_look', 'multi_weetabix'],
  abandon: ['abandon_nomore', 'abandon_deleted'],

  bay: ['bay_challenger', 'bay_fresh', 'bay_welcome', 'bay_tenballs', 'bay_claimed'],
  crowd: ['crowd_busy'],
  idle: ['idle_lonely', 'idle_noddedoff', 'idle_swingitself'],
  shopOpen: ['shop_again'],
  shopBall: ['shop_newball'],
  tutStart: ['tut_rookie'],
  tutDone: ['tut_done']
}

/** How often each moment gets a line, 0 to 1. Tune these to taste. */
const CHANCE: Record<VoiceMoment, number> = {
  great: 1, big: 1, red: 1, yellow: 1, green: 1, orange: 1, blue: 1, white: 1, black: 1,
  hot: 1, bunker: 1, miss: 1, out: 1, tutMiss: 1,
  wait: 1,
  strike: 0.3,
  flight: 0.6,
  windHelp: 0.6,
  windAgainst: 0.6,
  windAcross: 0.6,
  roll: 0.5,
  speed: 0.6,
  last: 0.8,
  round: 1,
  pb: 1,
  multiMid: 0.8,
  multiBig: 1,
  abandon: 1,
  bay: 0.7,
  crowd: 1,
  idle: 1,
  shopOpen: 0.5,
  shopBall: 0.7,
  tutStart: 1,
  tutDone: 1
}

/**
 * Seconds after the moment before the line starts, so it follows the score jingle or the strike.
 * A queued line waits for the one before to finish instead, then QUEUE_GAP.
 */
const DELAY: Partial<Record<VoiceMoment, number>> = {
  great: 0.35, big: 0.35, red: 0.35, yellow: 0.35, green: 0.35, orange: 0.35, blue: 0.35, white: 0.35,
  black: 0.35, hot: 0.35, bunker: 0.3, miss: 0.3, out: 0.3, tutMiss: 0.3,
  strike: 0.25,
  bay: 0.6,
  crowd: 0.6,
  tutStart: 1.5,
  last: 0.4
}
const QUEUE_GAP = 0.25

/** How important a moment is: a line only cuts off one of lower importance */
const PRIORITY: Partial<Record<VoiceMoment, number>> = {
  great: 3, big: 3, red: 3, yellow: 3, green: 3, orange: 3, blue: 3, white: 3, black: 3,
  hot: 3, bunker: 3, miss: 3, out: 3, tutMiss: 3,
  last: 3, round: 3, pb: 3, multiMid: 3, multiBig: 3, tutDone: 3,
  abandon: 2, tutStart: 2
  // anything not listed: 1
}

/** Seconds before the same moment can come round again (moments not listed can repeat at once) */
const COOLDOWN: Partial<Record<VoiceMoment, number>> = {
  bay: 45,
  crowd: 300,
  idle: 60,
  speed: 180,
  shopOpen: 120,
  shopBall: 20
}

/** How long each clip lasts, in seconds (measured from the files) */
const DURATION: Record<string, number> = {
  abandon_deleted: 3.47, abandon_nomore: 2.3, bay_challenger: 4.44, bay_claimed: 2.22,
  bay_fresh: 3.89, bay_tenballs: 2.82, bay_welcome: 4.78, betyoucouldnt: 1.44, bunker_beach: 1.46,
  bunker_bunker: 0.71, bunker_castles: 1.67, bunker_sand: 1.41, bunker_shoes: 3.29,
  crowd_busy: 2.59, flight_airtraffic: 2.01, flight_flyer: 2.22, flight_lunch: 2.12,
  flight_upup: 2.4, getinthehole: 1.62, great_1: 0.91, great_2: 0.91, hot_card: 2.77,
  hot_dance: 2.9, hot_fire: 3.13, hot_smug: 2.95, idle_lonely: 1.88, idle_noddedoff: 2.17,
  idle_swingitself: 2.66, last_final: 2.9, last_pressure: 3.19, miss_1: 1.18, miss_2: 1.07,
  miss_3: 1.12, miss_bold: 1.8, miss_notatarget: 3.0, miss_overthere: 2.17, miss_seenbetter: 3.5,
  miss_somewhere: 2.12, multi_crowd: 1.25, multi_look: 1.75, multi_notbad: 1.85,
  multi_weetabix: 1.72, out_bounds: 1.1, out_building: 1.67, out_garden: 2.09, out_gone: 2.77,
  out_postcode: 1.59, pb_bestyet: 3.42, pb_fridge: 3.06, pb_new: 1.23, roll_committed: 2.06,
  roll_fella: 2.3, roll_tour: 2.22, roll_tuesday: 2.56, round_damage: 2.3, round_sitdown: 2.46,
  round_words: 3.37, shop_again: 3.37, shop_newball: 3.68, speed_respect: 3.21, speed_train: 1.75,
  strike_clean: 2.69, strike_places: 1.96, strike_smashed: 3.03, strike_welly: 2.14,
  target_black: 3.11, target_blue: 1.96, target_green: 1.49, target_orange: 1.57, target_red: 3.21,
  target_white: 2.9, target_yellow: 2.3, taunt_1: 1.85, taunt_2: 1.62, tut_done: 4.26,
  tut_miss: 3.68, tut_rookie: 2.72, unbelievable: 1.1, wait_anytime: 1.18, wait_eternity: 2.53,
  wait_hititself: 2.72, wait_pose: 3.13, whatashot_1: 1.02, whatashot_2: 1.02, whatashot_3: 1.04,
  wind_against: 3.76, wind_assisted: 1.93, wind_crisp: 2.66, wind_say: 1.91
}

const VOLUME = 0.85

type Line = { clip: string; priority: number }

let source: Entity | null = null
let last = ''
let clock = 0
// The line waiting out its DELAY, the one playing (and until when), and the queue behind them
let pending: (Line & { at: number }) | null = null
let playing: Line | null = null
let playingUntil = 0
const queue: Line[] = []
const lastSaid: Partial<Record<VoiceMoment, number>> = {}

function play(line: Line): void {
  playing = line
  playingUntil = clock + (DURATION[line.clip] ?? 2)
  const level = voiceLevel()
  if (level <= 0) return
  AudioSource.createOrReplace(voiceSource(), {
    audioClipUrl: VO_DIR + line.clip + '.mp3',
    playing: true,
    loop: false,
    global: true,
    volume: VOLUME * level,
    currentTime: 0
  })
}

function voiceSource(): Entity {
  if (!source) {
    source = engine.addEntity()
    Transform.create(source, {})
    engine.addSystem((dt) => {
      clock += dt
      if (playing && clock >= playingUntil) playing = null
      if (pending && clock >= pending.at) {
        const line = pending
        pending = null
        play(line)
      }
      if (!pending && !playing && queue.length > 0) {
        const next = queue.shift()!
        pending = { ...next, at: clock + QUEUE_GAP }
      }
    })
  }
  return source
}

/** Whether a line is playing, waiting to start, or queued */
export function voiceBusy(): boolean {
  return pending !== null || playing !== null || queue.length > 0
}

export type SayOptions = {
  /** Wait for the line playing now to finish instead of being skipped */
  queue?: boolean
  /** Overrides the moment's CHANCE */
  chance?: number
  /** Overrides the moment's DELAY */
  delay?: number
}

/** Plays a line for a moment (if the dice say so). Returns whether one was started or queued. */
export function sayLine(moment: VoiceMoment, opts: SayOptions = {}): boolean {
  // Commentary switched off in Settings
  if (voiceLevel() <= 0) return false
  voiceSource()
  const cool = COOLDOWN[moment]
  const said = lastSaid[moment]
  if (cool !== undefined && said !== undefined && clock - said < cool) return false
  if (Math.random() >= (opts.chance ?? CHANCE[moment])) return false

  const priority = PRIORITY[moment] ?? 1
  const current = pending ?? playing
  const busy = current !== null || queue.length > 0
  if (busy && !opts.queue && current !== null && priority <= current.priority) return false

  let pool = LINES[moment]
  if (pool.length > 1) pool = pool.filter((c) => c !== last)
  const clip = pool[Math.floor(Math.random() * pool.length)]
  last = clip
  lastSaid[moment] = clock
  const line = { clip, priority }

  if (busy && opts.queue) {
    queue.push(line)
    return true
  }
  // Nothing playing, or this one matters more: it goes next, and anything queued is dropped
  queue.length = 0
  if (playing && playing.priority < priority) playing = null
  pending = { ...line, at: clock + (opts.delay ?? DELAY[moment] ?? 0) }
  return true
}
