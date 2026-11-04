/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { useInteraction } from './interaction'
import { boards } from '../ledger/client'
import { Period, secondsToReset } from '../ledger/rules'
import { playUi } from '../sfx'
import { menuReopenBlocked } from '../menuGuard'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'
import { screenRoom } from './screenRoom'
import { AchievementsTab } from './AchievementsTab'
import { PlayerStats } from './PlayerStats'

// The Achievements menu, from the trophy button on the range card (ui/RangeHud.tsx). It looks and
// works like the backpack (BackpackMenu.tsx), with three tabs:
//   - Badges: your achievements (ui/AchievementsTab.tsx)
//   - Leaderboard: today, this week, this month and all time, each with a True Score board (skill
//     only) and a Multiplier board. The daily board resets at 00:00 UTC, weeks on Monday, months
//     on the 1st.
//   - Stats: your Player Stats page (ui/PlayerStats.tsx)
// (The file keeps its old name, LeaderboardMenu, so everything that opens and closes it still does.)
// It's a menu like the others: F closes it, and no shot starts while it's open (index.ts).

export type AchievementsTabName = 'badges' | 'leaderboard' | 'stats'

type Row = { rank: string; name: string; value: string; mine: boolean }

export interface State {
  display: 'flex' | 'none'
  tab: AchievementsTabName
  period: Period
  board: 'true' | 'multi'
}

export const state: State = {
  display: 'none',
  tab: 'badges',
  period: 'day',
  board: 'true'
}

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const BLUE_LIGHT = { r: 0.161, g: 0.694, b: 0.898, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }
const PANEL = { r: 0.957, g: 0.969, b: 0.976, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const EDGE = { r: 0.835, g: 0.863, b: 0.886, a: 1 }

/** The same size as the backpack */
const WIDTH = 720
const HEIGHT = 700
const NARROW = 660

/** Opens the Achievements menu (on the tab it was last on), or closes it if it's open. */
export function toggleAchievements(): void {
  if (state.display === 'flex') {
    state.display = 'none'
    playUi('ui_close')
    return
  }
  if (menuReopenBlocked()) return
  state.display = 'flex'
  playUi('ui_open')
}

/** Opens the Achievements menu (the trophy button). */
export function openLeaderboards(): void {
  if (state.display !== 'flex' && menuReopenBlocked()) return
  state.display = 'flex'
}

function closeMenu(): void {
  state.display = 'none'
  playUi('ui_close')
}

function showTab(tab: AchievementsTabName): void {
  if (state.tab === tab) return
  state.tab = tab
  playUi('ui_select')
}

function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

function countdown(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  if (d > 0) return `${d}d ${h}h ${two(m)}m`
  return `${two(h)}:${two(m)}:${two(s)}`
}

/** A tab along the top, the same as the backpack's */
function tabButton(label: string, tab: AchievementsTabName, w: number, narrow: boolean) {
  const active = state.tab === tab
  const t = useInteraction(
    {
      base: {
        uiTransform: { width: w, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, margin: { left: narrow ? 3 : 6, right: narrow ? 3 : 6 } },
        uiBackground: { color: WHITE },
        onMouseDown: () => showTab(tab)
      },
      // Only the tabs not showing light up on hover (on the blue one it washed out the white text)
      hover: active ? undefined : { uiBackground: { color: PALE_BLUE } },
      active: { uiBackground: { color: BLUE } }
    },
    active
  )
  return (
    <UiEntity {...t}>
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={label} fontSize={narrow ? 14 : 16} color={active ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width: w - 6, height: 30 }} />
    </UiEntity>
  )
}

/** A smaller pill inside the Leaderboard tab: the period and the board */
function pill(label: string, active: boolean, onClick: () => void, width: number) {
  const t = useInteraction(
    {
      base: {
        uiTransform: { width, height: 34, justifyContent: 'center', alignItems: 'center', borderRadius: 17 },
        uiBackground: { color: WHITE },
        onMouseDown: onClick
      },
      hover: active ? undefined : { uiBackground: { color: PALE_BLUE } },
      active: { uiBackground: { color: BLUE } }
    },
    active
  )
  return (
    <UiEntity {...t}>
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={label} fontSize={14} color={active ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width, height: 28 }} />
    </UiEntity>
  )
}

const PERIODS: [Period, string][] = [
  ['day', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['all', 'All time']
]

/**
 * The Leaderboard tab: period and board pills, the top ten, then you and the countdown. Its own
 * component, so its pills' hover states stay its own when the tabs switch.
 */
function LeaderboardTab(props: { width: number; height: number }) {
  const { width, height } = props
  const me = getPlayer()?.userId ?? ''
  const table = boards.tables[state.period]
  const list = state.board === 'true' ? table.true : table.multi
  const rows: Row[] = list.map((r, i) => ({ rank: `${i + 1}`, name: r.n, value: fmt(r.v), mine: r.u === me }))
  const mine = boards.mine[state.period]
  const rank = state.board === 'true' ? mine.true : mine.multi
  const value = state.board === 'true' ? mine.trueV : mine.multiV
  const youText = rank > 0 ? `You: #${rank}  ·  ${fmt(value)}` : 'You: not on this board yet. Finish a round to post.'
  const resetText = state.period === 'all' ? 'Never resets' : `Resets in ${countdown(secondsToReset(state.period))}`
  const periodW = Math.floor((width - 3 * 8) / 4)
  // What's left for the rows: less the pills (34 + 8 + 34), their gaps and the line at the bottom
  const rowsH = Math.max(200, Math.min(400, height - 34 - 8 - 34 - 10 - 40))

  return (
    <UiEntity uiTransform={{ width, flexDirection: 'column' }}>
      {/* Period */}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
        {PERIODS.map(([p, name]) =>
          pill(
            name,
            state.period === p,
            () => {
              if (state.period === p) return
              state.period = p
              playUi('ui_click')
            },
            periodW
          )
        )}
      </UiEntity>

      {/* Board */}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: 8 } }}>
        {pill(
          'True Score',
          state.board === 'true',
          () => {
            if (state.board === 'true') return
            state.board = 'true'
            playUi('ui_click')
          },
          170
        )}
        <UiEntity uiTransform={{ width: 12 }} />
        {pill(
          'Multiplier',
          state.board === 'multi',
          () => {
            if (state.board === 'multi') return
            state.board = 'multi'
            playUi('ui_click')
          },
          170
        )}
      </UiEntity>

      {/* Rows */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: rowsH,
          flexDirection: 'column',
          padding: { top: 6, right: 12, bottom: 6, left: 12 },
          margin: { top: 10 },
          borderRadius: 18,
          borderWidth: 2,
          borderColor: EDGE,
          overflow: 'hidden'
        }}
        uiBackground={{ color: WHITE }}
      >
        <Label
          font="sans-serif"
          fontSrc={FONT_REGULAR}
          value="No rounds posted yet. Be the first."
          fontSize={15}
          color={GREY}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: rowsH - 20, display: rows.length === 0 ? 'flex' : 'none' }}
        />
        {rows.map((r) => (
          <UiEntity
            key={r.rank}
            uiTransform={{ width: '100%', height: 36, flexShrink: 0, flexDirection: 'row', alignItems: 'center', padding: { left: 8, right: 8 }, borderRadius: 10 }}
            uiBackground={{ color: r.mine ? PALE_BLUE : { r: 1, g: 1, b: 1, a: 0 } }}
          >
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={r.rank} fontSize={15} color={BLUE} textAlign="middle-left" uiTransform={{ width: 40, height: 30 }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={r.name} fontSize={15} color={NAVY} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: 30 }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={r.value} fontSize={15} color={NAVY} textAlign="middle-right" uiTransform={{ width: 130, height: 30 }} />
          </UiEntity>
        ))}
      </UiEntity>

      {/* You, and the countdown */}
      <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { top: 10 } }}>
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value={youText} fontSize={14} color={NAVY} textAlign="middle-left" uiTransform={{ width: width - 190, height: 26 }} />
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value={resetText} fontSize={13} color={GREY} textAlign="middle-right" uiTransform={{ width: 180, height: 26 }} />
      </UiEntity>
    </UiEntity>
  )
}

export function LeaderboardMenu(props: {}) {
  const closeButton = useInteraction({
    base: {
      uiTransform: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, borderWidth: 2, borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 } },
      uiBackground: { color: WHITE },
      onMouseDown: () => closeMenu()
    },
    hover: { uiTransform: { borderColor: BLUE_LIGHT }, uiBackground: { color: PALE_BLUE } }
  })

  // Fit the screen: never bigger than WIDTH x HEIGHT, and 12px clear of each edge (as the backpack)
  const room = screenRoom()
  const width = Math.min(WIDTH, room.w - 24)
  const height = Math.min(HEIGHT, room.h - 24)
  const narrow = width < NARROW
  const pad = narrow ? 12 : 24
  const tabW = Math.min(150, Math.floor((width - 16) / 3) - (narrow ? 6 : 12))
  // The room inside for the tab showing (less the frame, header, tabs and padding)
  const innerW = width - 8 - pad * 2
  const innerH = height - 8 - 64 - 64 - 18

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block', zIndex: 15 }}
    >
      {/* The dim behind it, oversized like the other menus' so it covers a phone's whole screen */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: 'block' }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.35 } }}
        // Clicking outside the panel (the trophy button included) closes it
        onMouseDown={() => closeMenu()}
      />
      <UiEntity
        uiTransform={{ width, height, flexDirection: 'column', borderRadius: 28, borderWidth: 4, borderColor: WHITE, overflow: 'hidden' }}
        uiBackground={{ color: PANEL }}
      >
        {/* Header */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 64,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: { right: 14 },
            borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
            borderColor: EDGE
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity uiTransform={{ width: 240, height: 44, alignItems: 'center', padding: { left: 26 }, borderRadius: { topLeft: 24, bottomRight: 22 } }} uiBackground={{ color: BLUE }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="Achievements" fontSize={19} color={WHITE} textAlign="middle-left" uiTransform={{ width: 200, height: 30 }} />
          </UiEntity>
          <UiEntity uiTransform={{ height: 62, alignItems: 'center' }}>
            <UiEntity {...closeButton}>
              <UiEntity uiTransform={{ width: 16, height: 16 }} uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }} />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Tabs */}
        <UiEntity uiTransform={{ width: '100%', height: 64, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
          {tabButton('Badges', 'badges', tabW, narrow)}
          {tabButton('Leaderboard', 'leaderboard', tabW, narrow)}
          {tabButton('Stats', 'stats', tabW, narrow)}
        </UiEntity>

        {/* The tab showing */}
        <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', padding: { left: pad, right: pad, bottom: 18 } }}>
          {state.tab === 'badges' ? <AchievementsTab width={innerW} height={innerH} /> : null}
          {state.tab === 'leaderboard' ? <LeaderboardTab width={innerW} height={innerH} /> : null}
          {state.tab === 'stats' ? <PlayerStats /> : null}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
