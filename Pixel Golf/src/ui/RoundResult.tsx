/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { boards } from '../ledger/client'
import { playUi } from '../sfx'
import { forTouch } from '../mobile'

// The card that opens when the tenth ball lands. It shows your True Score
// straight away, then fills in the multiplier roll, XP and Pixel Points when the
// ledger answers. index.ts calls showRoundFinished() and showRoundCounted().
//
// The same card says "Tutorial complete" when the tutorial's last shot lands
// (showTutorialComplete, from tutorial.ts), without the multiplier, and shows the
// level the tutorial took the player to when the server answers (showTutorialReward).

export interface State {
  display: 'flex' | 'none'
  title: string
  scoreLabel: string
  roundDisplay: 'flex' | 'none'
  levelDisplay: 'flex' | 'none'
  levelText: string
  buttonText: string
  trueScore: string
  hotText: string
  rollText: string
  multiScore: string
  rewardText: string
  statusText: string
  bestDisplay: 'flex' | 'none'
  rankText: string
}

export const state: State = {
  display: 'none',
  title: 'Round complete',
  scoreLabel: 'TRUE SCORE',
  roundDisplay: 'flex',
  levelDisplay: 'none',
  levelText: '',
  buttonText: 'Continue',
  trueScore: '0',
  hotText: '',
  rollText: '-',
  multiScore: '-',
  rewardText: '',
  statusText: 'Counting your round...',
  bestDisplay: 'none',
  rankText: ''
}

type UiAction = { state: State; props: Parameters<typeof RoundResult>[0]; value?: unknown }

function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

/** The round is over on this client: show the score while the ledger counts it. */
export function showRoundFinished(score: number, hotHits: number) {
  state.display = 'flex'
  state.title = 'Round complete'
  state.scoreLabel = 'TRUE SCORE'
  state.roundDisplay = 'flex'
  state.levelDisplay = 'none'
  state.buttonText = 'Continue'
  state.trueScore = fmt(score)
  state.hotText = hotHits === 1 ? '1 hot target hit' : `${hotHits} hot target hits`
  state.rollText = '-'
  state.multiScore = '-'
  state.rewardText = ''
  state.statusText = 'Counting your round...'
  state.bestDisplay = 'none'
  state.rankText = ''
}

/** The ledger's answer. */
export function showRoundCounted(r: {
  trueScore: number
  roll: number
  players: number
  multiScore: number
  xp: number
  points: number
  personalBest: boolean
  counted: boolean
  reason: string
}) {
  state.display = 'flex'
  if (!r.counted) {
    state.statusText = r.reason || 'This round was not counted.'
    return
  }
  state.trueScore = fmt(r.trueScore)
  state.rollText = `x${r.roll}`
  state.multiScore = fmt(r.multiScore)
  state.rewardText = `+${fmt(r.xp)} XP     +${fmt(r.points)} Pixel Points`
  state.statusText = r.players === 1 ? 'Rolled with 1 player here' : `Rolled with ${r.players} players here`
  state.bestDisplay = r.personalBest ? 'flex' : 'none'
}

/** The tutorial's last shot has landed. The reward fills in when the server answers. */
export function showTutorialComplete(score: number) {
  state.display = 'flex'
  state.title = 'Tutorial complete!'
  state.scoreLabel = 'YOUR SCORE'
  state.trueScore = fmt(score)
  state.hotText = 'Every target you landed counted'
  state.roundDisplay = 'none'
  state.levelDisplay = 'none'
  state.levelText = ''
  state.rewardText = ''
  state.statusText = 'Saving your progress...'
  state.bestDisplay = 'none'
  state.rankText = ''
  state.buttonText = "Let's play"
}

/** What finishing the tutorial gave: the XP and the level it took them to. */
export function showTutorialReward(r: { xp: number; level: number; unlocked: string[] }) {
  if (state.title !== 'Tutorial complete!') return
  state.levelDisplay = 'flex'
  state.levelText = `LEVEL ${r.level}`
  state.rewardText = r.xp > 0 ? `+${fmt(r.xp)} XP` : ''
  state.statusText = forTouch(
    r.unlocked.length
      ? `Unlocked: ${r.unlocked.join(', ')}. Click a free bay's Tee Off screen to play.`
      : "Click a free bay's Tee Off screen to start playing for real."
  )
}

// @ui-action
function closeCard({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_close')
}

export function RoundResult(props: {}) {
  // Today's place, once the ledger has said
  const today = boards.mine.day
  state.rankText = today.true > 0 ? `#${today.true} on today's True Score board` : ''

  const closeButton = useInteraction({
    base: {
      uiTransform: {
        width: 200,
        height: 46,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 23
      },
      uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } },
      onMouseDown: () => closeCard({ state, props })
    },
    hover: {
      uiBackground: { color: { r: 0.208, g: 0.62, b: 0.137, a: 1 } }
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
        zIndex: 20
      }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.35 } }}
    >
      <UiEntity
        uiTransform={{
          width: 540,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { bottom: 24 },
          borderRadius: 28,
          borderWidth: 4,
          borderColor: { r: 1, g: 1, b: 1, a: 1 },
          overflow: 'hidden'
        }}
        uiBackground={{ color: { r: 0.957, g: 0.969, b: 0.976, a: 1 } }}
      >
        {/* Header */}
        <UiEntity
          uiTransform={{ width: '100%', height: 58, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
        >
          <Label value={state.title} fontSize={22} color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-center" uiTransform={{ width: 400, height: 34 }} />
        </UiEntity>

        {/* Personal best */}
        <UiEntity
          uiTransform={{ height: 30, padding: { left: 16, right: 16 }, margin: { top: 14 }, borderRadius: 15, alignItems: 'center', display: state.bestDisplay }}
          uiBackground={{ color: { r: 1, g: 0.549, b: 0.102, a: 1 } }}
        >
          <Label value="New personal best!" fontSize={14} color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-center" uiTransform={{ width: 180, height: 26 }} />
        </UiEntity>

        {/* Level reached (tutorial) */}
        <UiEntity
          uiTransform={{
            height: 40,
            padding: { left: 24, right: 24 },
            margin: { top: 16 },
            borderRadius: 20,
            alignItems: 'center',
            display: state.levelDisplay
          }}
          uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
        >
          <Label value={state.levelText} fontSize={22} color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-center" uiTransform={{ width: 140, height: 34 }} />
        </UiEntity>

        {/* True Score */}
        <Label value={state.scoreLabel} fontSize={13} color={{ r: 0.075, g: 0.533, b: 0.722, a: 1 }} textAlign="middle-center" uiTransform={{ width: 300, height: 20, margin: { top: 14 } }} />
        <Label value={state.trueScore} fontSize={56} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-center" uiTransform={{ width: 460, height: 70 }} />
        <Label value={state.hotText} fontSize={14} color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-center" uiTransform={{ width: 460, height: 20 }} />

        {/* Multiplier */}
        <UiEntity
          uiTransform={{
            width: 460,
            height: 76,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: { left: 20, right: 20 },
            margin: { top: 16 },
            borderRadius: 18,
            borderWidth: 2,
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 },
            display: state.roundDisplay
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
        >
          <UiEntity uiTransform={{ flexDirection: 'column' }}>
            <Label value="MULTIPLIER ROLL" fontSize={12} color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-left" uiTransform={{ width: 160, height: 18 }} />
            <Label value={state.rollText} fontSize={30} color={{ r: 1, g: 0.549, b: 0.102, a: 1 }} textAlign="middle-left" uiTransform={{ width: 160, height: 40 }} />
          </UiEntity>
          <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'flex-end' }}>
            <Label value="MULTIPLIER SCORE" fontSize={12} color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-right" uiTransform={{ width: 220, height: 18 }} />
            <Label value={state.multiScore} fontSize={26} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-right" uiTransform={{ width: 220, height: 40 }} />
          </UiEntity>
        </UiEntity>

        <Label value={state.statusText} fontSize={13} textWrap="wrap" color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-center" uiTransform={{ width: 460, height: 36, margin: { top: 8 } }} />
        <Label value={state.rewardText} fontSize={18} color={{ r: 0.165, g: 0.525, b: 0.106, a: 1 }} textAlign="middle-center" uiTransform={{ width: 460, height: 28, margin: { top: 4 } }} />
        <Label value={state.rankText} fontSize={14} color={{ r: 0.075, g: 0.533, b: 0.722, a: 1 }} textAlign="middle-center" uiTransform={{ width: 460, height: 22 }} />

        <UiEntity uiTransform={{ margin: { top: 14 } }}>
          <UiEntity {...closeButton}>
            <Label value={state.buttonText} fontSize={18} color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-center" uiTransform={{ width: 180, height: 40 }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
