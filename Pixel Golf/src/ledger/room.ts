import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

/**
 * The wire between the scene and its Multiplayer Server.
 *
 * Its own module with no imports of ours, because both ends need it and if it
 * lived in either one they would import each other in a circle.
 *
 * Open-ended data (a round's balls, an owned list, the leaderboards) travels as
 * JSON strings, so adding a cosmetic or a column never changes a schema.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: never add a field to a message below once it has shipped.
 * ---------------------------------------------------------------------------
 * A Schemas.Map has no field tags: fields are read back in declaration order.
 * The client and the server can run different builds for a while after a
 * deploy, and a message with one field more or fewer than the reader expects
 * doesn't arrive with a field missing, it fails to decode altogether. That took
 * everyone's ball and club away twice in Pirate Mini Golf. When something new
 * needs sending, add a new message instead. An old server never sends it and an
 * old client never hears it, and everything else carries on.
 */
export const MESSAGES = {
  // -------------------------------------------------------------------------
  // Scene -> server
  // -------------------------------------------------------------------------

  /**
   * I have arrived. The display name rides along because the server only knows
   * wallets, and a leaderboard of wallets is one nobody can read. Sent again
   * when the profile loads late, so the name on the boards is right.
   */
  hello: Schemas.Map({ version: Schemas.Int, name: Schemas.String }),

  /**
   * Still here. Sent every 20 seconds by every player in the scene, playing or
   * AFK, so the server knows how many people are in the space. That number is
   * the ceiling of the shared multiplier.
   */
  here: Schemas.Map({ n: Schemas.Int }),

  /**
   * A finished round. JSON array of ROUND_BALLS entries { z, p, h }: the zone
   * the ball finished in ('' for none), its base points before any doubling,
   * and 1 if that zone was hot when it landed. The server checks every ball,
   * doubles the hot ones, rolls the multiplier and pays.
   */
  round: Schemas.Map({ balls: Schemas.String }),

  /** A minute spent on the AFK practice range. Pays XP, never Pixel Points. */
  afk: Schemas.Map({ n: Schemas.Int }),

  /** Buy a cosmetic. Priced by the server from the catalogue in rules.ts. */
  buy: Schemas.Map({ id: Schemas.String }),

  /** Hold a cosmetic already owned. */
  equip: Schemas.Map({ id: Schemas.String }),

  /** A switch moved in the Settings panel. One key at a time. */
  settings: Schemas.Map({ key: Schemas.String, on: Schemas.Boolean }),

  /**
   * I want to play in this bay. One bay per player: claiming a new one lets the
   * old one go. Refused if someone else in the space already has it.
   */
  claimBay: Schemas.Map({ bay: Schemas.Int }),

  /** I finished the tutorial round. The server ticks it off on my ledger. */
  tutorialDone: Schemas.Map({ n: Schemas.Int }),

  /**
   * I've left the solo bay (bay 20) without picking another bay, e.g. walked away. Joining it is
   * a normal claimBay for bay 20, which the server treats as "add me" rather than "it's mine".
   */
  leaveSolo: Schemas.Map({ n: Schemas.Int }),

  /**
   * My club, so everyone else can see it in my hand: which club ('wedge' | 'iron' | 'driver'),
   * whether it's out, and whether it's in the swing grip. Sent only when one of those changes.
   */
  clubState: Schemas.Map({ type: Schemas.String, show: Schemas.Boolean, swing: Schemas.Boolean }),

  /**
   * Admin only: wipe every player's progress and all eight leaderboards. Refused unless the
   * sender's wallet is in ADMIN.wallets (rules.ts). `confirm` must be RESET_CONFIRM.
   */
  adminReset: Schemas.Map({ confirm: Schemas.String }),

  // -------------------------------------------------------------------------
  // Server -> one player
  // -------------------------------------------------------------------------

  /**
   * Everything the server holds for this player. Sent on hello and after
   * anything that changes it, so the scene never works a balance out itself.
   * The level is not sent: both ends read it off xp with rules.ts.
   */
  ledger: Schemas.Map({
    /** Total XP ever. */
    xp: Schemas.Int,
    /** Pixel Points to spend. */
    points: Schemas.Int,
    /** Pixel Points ever earned. */
    pointsEarned: Schemas.Int,
    /** Best True Score round, and best Multiplier round. */
    best: Schemas.Int,
    bestMulti: Schemas.Int,
    /** Rounds finished. */
    rounds: Schemas.Int,
    /** JSON string[]: cosmetics this player can use. */
    owned: Schemas.String,
    /** JSON { ball, club }: what they are using. */
    equipped: Schemas.String,
    /** Seconds until the daily login bonus can be collected again. */
    dailyIn: Schemas.Int,
    /** False for a guest, whose progress can't be kept between visits. */
    durable: Schemas.Boolean
  }),

  /**
   * Whether this player has finished the tutorial. Sent right after every ledger. Its own message
   * rather than a ledger field, because a field added to a shipped message breaks decoding.
   */
  tutorial: Schemas.Map({ done: Schemas.Boolean }),

  /** The switches this player has saved, as one JSON object. */
  mySettings: Schemas.Map({ json: Schemas.String }),

  /**
   * Server -> everyone: an admin has just reset the ledger. Every scene clears what it was
   * showing and says hello again, which brings back the fresh, empty ledger (and the tutorial).
   */
  ledgerReset: Schemas.Map({ by: Schemas.String }),

  /**
   * Server -> everyone: who is playing in the solo bay (bay 20) right now, as a JSON string[] of
   * wallets. Any number of players can be in it at once. Scenes hide these players while they're
   * in the bay; anyone else standing there stays visible.
   */
  soloPlayers: Schemas.Map({ json: Schemas.String }),

  /** Server -> everyone: one player's club (their clubState), with their wallet. */
  clubSeen: Schemas.Map({ u: Schemas.String, type: Schemas.String, show: Schemas.Boolean, swing: Schemas.Boolean }),

  /**
   * Server -> one player: what finishing the tutorial gave them. The XP that took them to
   * TUTORIAL_LEVEL, the level they're now at, and a JSON string[] of anything that level unlocked.
   */
  tutorialReward: Schemas.Map({ xp: Schemas.Int, level: Schemas.Int, unlocked: Schemas.String }),

  /** What a round was worth, for the round result card. */
  roundResult: Schemas.Map({
    /** Base points with hot targets doubled. Posts to the True Score boards. */
    trueScore: Schemas.Int,
    /** The multiplier rolled for this round. */
    roll: Schemas.Int,
    /** How many players were in the space, which was the roll's ceiling. */
    players: Schemas.Int,
    /** trueScore x roll. Posts to the Multiplier boards. */
    multiScore: Schemas.Int,
    /** Hot target hits in the round. */
    hotHits: Schemas.Int,
    xp: Schemas.Int,
    points: Schemas.Int,
    /** True if this beat their best True Score. */
    personalBest: Schemas.Boolean,
    /** False if the round was not counted. reason says why. */
    counted: Schemas.Boolean,
    reason: Schemas.String
  }),

  /** Something paid, and why, for a callout. */
  awarded: Schemas.Map({ xp: Schemas.Int, points: Schemas.Int, reason: Schemas.String }),

  /** They went up. gained can be more than 1. unlocked is a JSON string[] of cosmetic names. */
  levelUp: Schemas.Map({ level: Schemas.Int, gained: Schemas.Int, unlocked: Schemas.String }),

  /** Where this player sits on every board. JSON, see leaders.ts ranksFor(). */
  myRanks: Schemas.Map({ json: Schemas.String }),

  /** A purchase or equip that could not go through, and why. */
  refused: Schemas.Map({ reason: Schemas.String }),

  // -------------------------------------------------------------------------
  // Server -> everyone
  // -------------------------------------------------------------------------

  /**
   * The range right now: which target is hot, how many seconds it has left,
   * and how many players are in the space. Sent at every rotation, when the
   * player count changes, and to each player as they arrive.
   */
  range: Schemas.Map({ hot: Schemas.String, seconds: Schemas.Int, players: Schemas.Int }),

  /**
   * Who has which bay. JSON { "5": { u: wallet, n: name }, ... }. Sent when a bay
   * is claimed or let go (a player who leaves the space lets theirs go), and to
   * each player as they arrive.
   */
  bays: Schemas.Map({ json: Schemas.String }),

  /** I just hit the ball in my bay, at this launch velocity (m/s). */
  shot: Schemas.Map({ bay: Schemas.Int, vx: Schemas.Float, vy: Schemas.Float, vz: Schemas.Float }),

  /** My ball has settled: my bay's numbers, for the screen on my bay. */
  shotDone: Schemas.Map({
    bay: Schemas.Int,
    score: Schemas.Int,
    shot: Schemas.Int,
    last: Schemas.Int,
    zone: Schemas.String,
    hot: Schemas.Boolean
  }),

  /** Server -> everyone: someone hit the ball in their bay. Play it on that bay's ball. */
  shotSeen: Schemas.Map({ bay: Schemas.Int, vx: Schemas.Float, vy: Schemas.Float, vz: Schemas.Float }),

  /** Server -> everyone: a bay's numbers after a shot, for its screen. */
  bayScore: Schemas.Map({
    bay: Schemas.Int,
    score: Schemas.Int,
    shot: Schemas.Int,
    last: Schemas.Int,
    zone: Schemas.String,
    hot: Schemas.Boolean
  }),

  /** A big multiplier roll, for everyone to see. */
  rolled: Schemas.Map({ name: Schemas.String, roll: Schemas.Int, score: Schemas.Int }),

  /**
   * The leaderboards: all-time, monthly, weekly and daily, each with a True
   * Score board and a Multiplier board. One JSON string, see leaders.ts.
   */
  leaders: Schemas.Map({ json: Schemas.String }),

  // -------------------------------------------------------------------------
  // Server-simulated shots (added 2026-10-15). New messages at the end, so
  // nothing above changes. `shot` and `shotSeen` above are the old velocity
  // relay: kept for clients still on the old build, no longer used by this one.
  // -------------------------------------------------------------------------

  /**
   * Scene -> server: simulate my shot in my bay. id is mine, to match the reply. s* is where
   * the ball sits (the server uses its own copy of the tee when it has one), v* the launch
   * velocity in m/s. Sent when the curve is locked, so the answer arrives during the swing.
   */
  shotAsk: Schemas.Map({
    bay: Schemas.Int,
    id: Schemas.Int,
    sx: Schemas.Float,
    sy: Schemas.Float,
    sz: Schemas.Float,
    vx: Schemas.Float,
    vy: Schemas.Float,
    vz: Schemas.Float
  }),

  /**
   * Server -> everyone: a shot, simulated once. u is the shooter's wallet and id their request
   * id. data is the keyframes, encodePath() in ballSim.ts. Every screen plays the same ball.
   */
  shotPath: Schemas.Map({ bay: Schemas.Int, id: Schemas.Int, u: Schemas.String, data: Schemas.String }),

  /** Server -> one player: that shot won't be simulated, and why. The scene plays it locally. */
  shotNo: Schemas.Map({ bay: Schemas.Int, id: Schemas.Int, reason: Schemas.String }),

  // Wind (added 2026-10-19)

  /**
   * Server -> everyone: the range's wind. dir is where it blows to in degrees (0 = +z, 90 = +x),
   * speed in m/s, seconds until it next changes. Sent when it changes and on hello.
   */
  wind: Schemas.Map({ dir: Schemas.Float, speed: Schemas.Float, seconds: Schemas.Int }),

  // Leaving a bay (added 2026-10-19)

  /** Scene -> server: I've walked away from this bay, so free it for anyone. Ignored if it isn't mine. */
  leaveBay: Schemas.Map({ bay: Schemas.Int }),

  // Ball looks (added 2026-10-19)

  /**
   * Server -> everyone: which ball each player has equipped, as a JSON { wallet: ballId } (only
   * players with something other than the standard ball). Sent whenever one changes, and on
   * hello. Every screen shows each bay's ball in its player's ball.
   */
  ballLooks: Schemas.Map({ json: Schemas.String })
}

export const room = registerMessages(MESSAGES)
