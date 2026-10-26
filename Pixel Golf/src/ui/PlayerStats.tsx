/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { profile, boards, stats } from '../ledger/client'
import { CATALOGUE, Period } from '../ledger/rules'
import { HOT_LOOKS } from '../hotLooks'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// The Player Stats page, shown in the right of the Pixel Golf menu when Player Stats is picked
// (GameModeMenu.tsx). Three bands:
//   - the headline numbers: Pixel Points, rounds, best True Score, best multiplier round
//   - leaderboard places on all four boards, True Score and Multiplier
//   - YOUR GAME: hits on each target colour, then accuracy, hot hits, best shot, average round,
//     perfect rounds, multiplier rolls, longest shot, favourite club, login streak, time on the
//     range, AFK minutes and balls owned
// The headline numbers and ranks come from the ledger; the rest from the stats the server keeps
// from each round and shot (Stats in ledger/server.ts), counted since the day it started.
// Fits the menu's right-hand area: about 660 wide, about 420 tall.

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const LINE = { r: 0.835, g: 0.863, b: 0.886, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }

const WIDTH = 656
const TARGETS = ['Red', 'Yellow', 'Green', 'Orange', 'Blue', 'White', 'Black']
const PERIOD_NAMES: [Period, string][] = [
  ['day', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['all', 'All time']
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

function hoursMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** A tile: a small label over a value, with an optional note under it */
function tile(key: string, width: number, height: number, label: string, value: string, note = '', highlight = false) {
  return (
    <UiEntity
      key={key}
      uiTransform={{
        width,
        height,
        flexDirection: 'column',
        justifyContent: 'center',
        padding: { left: 12, right: 8 },
        borderRadius: 14,
        borderWidth: 2,
        borderColor: highlight ? { r: 0.161, g: 0.694, b: 0.898, a: 1 } : LINE
      }}
      uiBackground={{ color: highlight ? PALE_BLUE : WHITE }}
    >
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={label} fontSize={10} color={BLUE} textAlign="middle-left" uiTransform={{ width: width - 20, height: 14 }} />
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={value} fontSize={highlight ? 20 : 15} color={NAVY} textAlign="middle-left" uiTransform={{ width: width - 20, height: highlight ? 26 : 21 }} />
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={note} fontSize={10} color={GREY} textAlign="middle-left" uiTransform={{ width: width - 20, height: note ? 14 : 0, display: note ? 'flex' : 'none' }} />
    </UiEntity>
  )
}

export function PlayerStats(props: {}) {
  const ok = stats.ready
  const dash = '-'

  // Headline tiles
  const headW = (WIDTH - 3 * 10) / 4
  const heads = [
    tile('pp', headW, 76, 'PIXEL POINTS', profile.ready ? fmt(profile.points) : dash, profile.ready ? `${fmt(profile.pointsEarned)} earned in all` : '', true),
    tile('rounds', headW, 76, 'ROUNDS PLAYED', profile.ready ? fmt(profile.rounds) : dash, '', true),
    tile('best', headW, 76, 'BEST TRUE SCORE', profile.ready ? fmt(profile.best) : dash, '', true),
    tile('multi', headW, 76, 'BEST MULTIPLIER', profile.ready ? fmt(profile.bestMulti) : dash, '', true)
  ]

  // Leaderboard places
  const rank = (n: number) => (n > 0 ? `#${n}` : dash)

  // Your game
  const hitsTotal = TARGETS.reduce((n, c) => n + (stats.hits[c] ?? 0), 0)
  const accuracy = stats.balls > 0 ? `${Math.round((hitsTotal / stats.balls) * 100)}%` : dash
  const average = stats.rounds > 0 ? fmt(stats.totalScore / stats.rounds) : dash
  let favourite = ''
  let favouriteUses = 0
  for (const club in stats.clubs) {
    if (stats.clubs[club] > favouriteUses) {
      favourite = club
      favouriteUses = stats.clubs[club]
    }
  }
  // Ball looks (Joel's ball properties made the ball's look 'ballVis' and its physics 'ballProp')
  const balls = CATALOGUE.filter((i) => i.kind === 'ballVis' && !i.shelved)
  const ownedBalls = balls.filter((i) => i.id === 'ball-classic' || profile.owned.indexOf(i.id) >= 0).length
  const since = stats.since > 0 ? new Date(stats.since * 1000) : null
  const sinceText = since ? `Counted since ${since.getUTCDate()} ${MONTHS[since.getUTCMonth()]}` : ''

  const chipGap = 8
  const chipW = (WIDTH - 32 - chipGap * (TARGETS.length - 1)) / TARGETS.length
  const cols = 5
  const gap = 8
  const tileW = (WIDTH - 32 - gap * (cols - 1)) / cols
  const tiles = [
    tile('acc', tileW, 46, 'ACCURACY', ok ? accuracy : dash),
    tile('balls', tileW, 46, 'BALLS HIT', ok ? fmt(stats.balls) : dash),
    tile('hot', tileW, 46, 'HOT HITS', ok ? fmt(stats.hotHits) : dash),
    tile('bestshot', tileW, 46, stats.bestShotZone ? `BEST SHOT (${stats.bestShotZone.toUpperCase()})` : 'BEST SHOT', ok && stats.bestShot > 0 ? fmt(stats.bestShot) : dash),
    tile('avg', tileW, 46, 'AVERAGE ROUND', ok ? average : dash),
    tile('perfect', tileW, 46, 'PERFECT ROUNDS', ok ? fmt(stats.perfect) : dash),
    tile('roll', tileW, 46, 'BIGGEST ROLL', ok && stats.biggestRoll > 0 ? `${stats.biggestRoll}x` : dash),
    tile('bigrolls', tileW, 46, '5X+ ROLLS', ok ? fmt(stats.bigRolls) : dash),
    tile('longest', tileW, 46, stats.longestClub ? `LONGEST (${stats.longestClub.toUpperCase()})` : 'LONGEST SHOT', ok && stats.longest > 0 ? `${stats.longest} m` : dash),
    tile('club', tileW, 46, 'FAVOURITE CLUB', ok && favourite ? cap(favourite) : dash),
    tile('streak', tileW, 46, ok ? `DAY STREAK (BEST ${stats.bestStreak})` : 'DAY STREAK', ok ? `${stats.streak} ${stats.streak === 1 ? 'day' : 'days'}` : dash),
    tile('time', tileW, 46, 'TIME ON RANGE', ok ? hoursMinutes(stats.playSeconds) : dash),
    tile('afk', tileW, 46, 'AFK MINUTES', ok ? fmt(stats.afkMinutes) : dash),
    tile('owned', tileW, 46, 'BALLS OWNED', profile.ready ? `${ownedBalls} / ${balls.length}` : dash),
    tile('misses', tileW, 46, 'MISSES / BUNKERS', ok ? `${fmt(stats.misses)} / ${fmt(stats.bunkers)}` : dash)
  ]

  return (
    <UiEntity uiTransform={{ width: WIDTH, height: '100%', flexDirection: 'column' }}>
      {/* Headline numbers */}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>{heads}</UiEntity>

      {/* Leaderboard places */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 58,
          flexDirection: 'row',
          alignItems: 'center',
          margin: { top: 10 },
          padding: { left: 14, right: 14 },
          borderRadius: 14,
          borderWidth: 2,
          borderColor: LINE
        }}
        uiBackground={{ color: WHITE }}
      >
        <UiEntity uiTransform={{ width: 108, flexDirection: 'column' }}>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value="LEADERBOARDS" fontSize={10} color={BLUE} textAlign="middle-left" uiTransform={{ width: 108, height: 14 }} />
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value="True / Multiplier" fontSize={11} color={GREY} textAlign="middle-left" uiTransform={{ width: 108, height: 16 }} />
        </UiEntity>
        {PERIOD_NAMES.map(([p, name]) => (
          <UiEntity key={`rank-${p}`} uiTransform={{ width: (WIDTH - 28 - 108) / 4, flexDirection: 'column', alignItems: 'center' }}>
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={name} fontSize={11} color={GREY} textAlign="middle-center" uiTransform={{ width: 120, height: 15 }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR}
              value={boards.ready ? `${rank(boards.mine[p].true)}  /  ${rank(boards.mine[p].multi)}` : dash}
              fontSize={16}
              color={NAVY}
              textAlign="middle-center"
              uiTransform={{ width: 120, height: 22 }}
            />
          </UiEntity>
        ))}
      </UiEntity>

      {/* Your game */}
      <UiEntity
        uiTransform={{
          width: '100%',
          flexGrow: 1,
          flexDirection: 'column',
          margin: { top: 10 },
          padding: { top: 10, right: 16, bottom: 10, left: 16 },
          borderRadius: 18,
          borderWidth: 2,
          borderColor: LINE
        }}
        uiBackground={{ color: { r: 0.98, g: 0.984, b: 0.988, a: 1 } }}
      >
        <UiEntity uiTransform={{ width: '100%', height: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value="YOUR GAME" fontSize={12} color={BLUE} textAlign="middle-left" uiTransform={{ width: 200, height: 18 }} />
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={ok ? sinceText : 'Loading your stats...'} fontSize={11} color={GREY} textAlign="middle-right" uiTransform={{ width: 300, height: 18 }} />
        </UiEntity>

        {/* Hits on each target, in its own colour */}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 8 } }}>
          {TARGETS.map((c) => {
            const look = HOT_LOOKS[c]
            return (
              <UiEntity
                key={`hits-${c}`}
                uiTransform={{
                  width: chipW,
                  height: 46,
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: look.rim
                }}
                uiBackground={{ color: look.fill }}
              >
                <Label font="sans-serif" fontSrc={FONT_BOLD} value={ok ? fmt(stats.hits[c] ?? 0) : dash} fontSize={17} color={look.text} textAlign="middle-center" uiTransform={{ width: chipW - 4, height: 22 }} />
                <Label font="sans-serif" fontSrc={FONT_REGULAR} value={c.toUpperCase()} fontSize={9} color={look.text} textAlign="middle-center" uiTransform={{ width: chipW - 4, height: 12 }} />
              </UiEntity>
            )
          })}
        </UiEntity>

        {/* Everything else */}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', margin: { top: 8 } }}>
          {tiles.map((t, i) => (
            <UiEntity key={`tile-${i}`} uiTransform={{ margin: { bottom: 6 } }}>
              {t}
            </UiEntity>
          ))}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
