/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { useInteraction } from './interaction'
import { boards } from '../ledger/client'
import { Period, secondsToReset } from '../ledger/rules'
import { playUi } from '../sfx'

// The leaderboards: today, this week, this month and all time, each with a True
// Score board (skill only) and a Multiplier board. Opened from the range card.
// The daily board resets at 00:00 UTC, weeks on Monday, months on the 1st.

type Row = { rank: string; name: string; value: string; mine: boolean }

export interface State {
  display: 'flex' | 'none'
  period: Period
  board: 'true' | 'multi'
  rows: Row[]
  emptyDisplay: 'flex' | 'none'
  youText: string
  resetText: string
}

export const state: State = {
  display: 'none',
  period: 'day',
  board: 'true',
  rows: [],
  emptyDisplay: 'none',
  youText: '',
  resetText: ''
}

type UiAction = { state: State; props: Parameters<typeof LeaderboardMenu>[0]; value?: unknown }

export function openLeaderboards() {
  state.display = 'flex'
}

// @ui-action
function closeBoards({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_close')
}

// @ui-action
function showToday({ state, props }: UiAction) {
  state.period = 'day'
  playUi('ui_click')
}

// @ui-action
function showWeek({ state, props }: UiAction) {
  state.period = 'week'
  playUi('ui_click')
}

// @ui-action
function showMonth({ state, props }: UiAction) {
  state.period = 'month'
  playUi('ui_click')
}

// @ui-action
function showAllTime({ state, props }: UiAction) {
  state.period = 'all'
  playUi('ui_click')
}

// @ui-action
function showTrueScore({ state, props }: UiAction) {
  state.board = 'true'
  playUi('ui_click')
}

// @ui-action
function showMultiplier({ state, props }: UiAction) {
  state.board = 'multi'
  playUi('ui_click')
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

// A tab button: blue when chosen
function tab(label: string, active: boolean, onClick: () => void, width: number) {
  const t = useInteraction(
    {
      base: {
        uiTransform: { width, height: 38, justifyContent: 'center', alignItems: 'center', borderRadius: 19 },
        uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
        onMouseDown: onClick
      },
      hover: { uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } } },
      active: { uiBackground: { color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } } }
    },
    active
  )
  return (
    <UiEntity {...t}>
      <Label
        value={label}
        fontSize={14}
        color={active ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0.118, g: 0.204, b: 0.259, a: 1 }}
        textAlign="middle-center"
        uiTransform={{ width, height: 30 }}
      />
    </UiEntity>
  )
}

export function LeaderboardMenu(props: {}) {
  // Fill the rows from what the ledger last sent
  const me = getPlayer()?.userId ?? ''
  const table = boards.tables[state.period]
  const list = state.board === 'true' ? table.true : table.multi
  state.rows = list.map((r, i) => ({ rank: `${i + 1}`, name: r.n, value: fmt(r.v), mine: r.u === me }))
  state.emptyDisplay = list.length === 0 ? 'flex' : 'none'
  const mine = boards.mine[state.period]
  const rank = state.board === 'true' ? mine.true : mine.multi
  const value = state.board === 'true' ? mine.trueV : mine.multiV
  state.youText = rank > 0 ? `You: #${rank}  ·  ${fmt(value)}` : 'You: not on this board yet. Finish a round to post.'
  state.resetText = state.period === 'all' ? 'Never resets' : `Resets in ${countdown(secondsToReset(state.period))}`

  const closeButton = useInteraction({
    base: {
      uiTransform: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 20,
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: () => closeBoards({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
        pointerFilter: 'block',
        display: state.display,
        zIndex: 15
      }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0 } }}
    >
      {/* The dim behind the menu. Oversized and pinned outside this box, because on a phone the box is
          only the safe area, and a dim that stops at its edges shows as a dark rectangle */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: 'block' }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.35 } }}
      />
      <UiEntity
        uiTransform={{
          width: 620,
          flexDirection: 'column',
          borderRadius: 28,
          borderWidth: 4,
          borderColor: { r: 1, g: 1, b: 1, a: 1 },
          overflow: 'hidden'
        }}
        uiBackground={{ color: { r: 0.957, g: 0.969, b: 0.976, a: 1 } }}
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
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity
            uiTransform={{ width: 240, height: 44, alignItems: 'center', padding: { left: 26 }, borderRadius: { topLeft: 24, bottomRight: 22 } }}
            uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
          >
            <Label value="Leaderboards" fontSize={19} color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-left" uiTransform={{ width: 200, height: 30 }} />
          </UiEntity>
          <UiEntity uiTransform={{ height: 62, alignItems: 'center' }}>
            <UiEntity {...closeButton}>
              <UiEntity
                uiTransform={{ width: 16, height: 16 }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }}
              />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', padding: { top: 14, right: 20, bottom: 18, left: 20 } }}>
          {/* Period tabs */}
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
            {tab('Today', state.period === 'day', () => showToday({ state, props }), 136)}
            {tab('This week', state.period === 'week', () => showWeek({ state, props }), 136)}
            {tab('This month', state.period === 'month', () => showMonth({ state, props }), 136)}
            {tab('All time', state.period === 'all', () => showAllTime({ state, props }), 136)}
          </UiEntity>

          {/* Board tabs */}
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: 10 } }}>
            {tab('True Score', state.board === 'true', () => showTrueScore({ state, props }), 180)}
            <UiEntity uiTransform={{ width: 12 }} />
            {tab('Multiplier', state.board === 'multi', () => showMultiplier({ state, props }), 180)}
          </UiEntity>

          {/* Rows */}
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 380,
              flexDirection: 'column',
              padding: { top: 8, right: 12, bottom: 8, left: 12 },
              margin: { top: 12 },
              borderRadius: 18,
              borderWidth: 2,
              borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
            }}
            uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
          >
            <Label
              value="No rounds posted yet. Be the first."
              fontSize={15}
              color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
              textAlign="middle-center"
              uiTransform={{ width: '100%', height: 340, display: state.emptyDisplay }}
            />
            {state.rows.map((r) => (
              <UiEntity
                key={r.rank}
                uiTransform={{ width: '100%', height: 36, flexDirection: 'row', alignItems: 'center', padding: { left: 8, right: 8 }, borderRadius: 10 }}
                uiBackground={{ color: r.mine ? { r: 0.839, g: 0.949, b: 0.988, a: 1 } : { r: 1, g: 1, b: 1, a: 0 } }}
              >
                <Label value={r.rank} fontSize={15} color={{ r: 0.075, g: 0.533, b: 0.722, a: 1 }} textAlign="middle-left" uiTransform={{ width: 40, height: 30 }} />
                <Label value={r.name} fontSize={15} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-left" uiTransform={{ width: 330, height: 30 }} />
                <Label value={r.value} fontSize={15} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-right" uiTransform={{ flexGrow: 1, height: 30 }} />
              </UiEntity>
            ))}
          </UiEntity>

          {/* You, and the countdown */}
          <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { top: 10 } }}>
            <Label value={state.youText} fontSize={14} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-left" uiTransform={{ width: 380, height: 26 }} />
            <Label value={state.resetText} fontSize={13} color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-right" uiTransform={{ width: 180, height: 26 }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
