/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { profile, range, hotSecondsLeft, currentCeiling, currentFloor, tutorial, effectiveHot } from '../ledger/client'
import { hotLook, faded } from '../hotLooks'
import { getRoundProgress } from '../game'
import { openLeaderboards } from './LeaderboardMenu'
import { toggleSettings } from './SettingsMenu'
import { toggleBackpack } from './BackpackMenu'
import { windReadout } from '../wind'
import { playUi } from '../sfx'
import { perfStats } from '../index'
import { onPhone, forTouch, PHONE_RIGHT_SHIFT } from '../mobile'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// Shows frame rate and physics time per frame under the card, for testing on phones.
// Set to false before release.
const PERF_READOUT = true

// The green callouts under the card (level ups, the daily bonus, big rolls, "bay in use" and so
// on, from showToast). Hidden for now; set true to bring them back.
const SHOW_CALLOUTS = false

// How far down the card starts. Higher on a phone: its screen is a third shorter, and the
// phone's round buttons fill the bottom right below the card.
const CARD_TOP = 150
// On a phone it sits in the top right corner (the Settings cog is on the card itself)
const CARD_TOP_PHONE = 20

// Phones get the same card as desktop (2026-10-20: same look everywhere), PHONE_SCALE times
// bigger and pushed out towards the right edge (PHONE_RIGHT_SHIFT in mobile.ts). PHONE_COMPACT
// true brings back the old tidier phone card (no multiplier box, no "Pixel Points" label, no
// frame rate readout, no wind words). The previous version is in RangeHud.tsx.bak.
const PHONE_COMPACT = false
const PHONE_SCALE = 1.1
const CARD_WIDTH = 240

// The scale every size in the card goes through: 1 on desktop, PHONE_SCALE on a phone
let scale = 1
const z = (n: number) => Math.round(n * scale)

// The range card on the right of the screen: the hot target and its countdown,
// your ball count and round total, the wind, the shared multiplier, your level and Pixel
// Points, and the Leaderboards and Settings buttons. Also shows short callouts (level ups, the
// daily bonus, big multiplier rolls) with showToast().

export interface State {
  hotName: string
  hotTime: string
  hotDisplay: 'flex' | 'none'
  ballText: string
  roundScore: string
  multiplierText: string
  playersText: string
  levelText: string
  pointsText: string
  toastText: string
  toastDisplay: 'flex' | 'none'
  perfText: string
  perfDisplay: 'flex' | 'none'
  /** Hidden on a phone's compact card */
  multiplierDisplay: 'flex' | 'none'
  pointsLabelDisplay: 'flex' | 'none'
}

export const state: State = {
  hotName: '',
  hotTime: '',
  hotDisplay: 'none',
  ballText: 'Ball 0/10',
  roundScore: '0',
  multiplierText: '2x',
  playersText: '1 player',
  levelText: 'LV -',
  pointsText: '-',
  toastText: '',
  toastDisplay: 'none',
  perfText: '',
  multiplierDisplay: 'flex',
  pointsLabelDisplay: 'flex',
  perfDisplay: 'none'
}

type UiAction = { state: State; props: Parameters<typeof RangeHud>[0]; value?: unknown }

let toastUntil = 0

/** A short callout under the range card. */
export function showToast(text: string, seconds = 4) {
  state.toastText = forTouch(text)
  toastUntil = Date.now() + seconds * 1000
}

// @ui-action
function openSettingsPanel({ state, props }: UiAction) {
  toggleSettings()
}

// @ui-action
function openBoards({ state, props }: UiAction) {
  playUi('ui_open')
  openLeaderboards()
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

export function RangeHud(props: {}) {
  // Read the live values each frame
  const left = hotSecondsLeft()
  // No hot target during the tutorial
  // In the tutorial only its lesson hot target (shot 5), which has no countdown
  const hotZone = effectiveHot()
  state.hotDisplay = hotZone && (tutorial.active || left > 0) ? 'flex' : 'none'
  state.hotName = hotZone.replace(/\d+$/, '')
  state.hotTime = tutorial.active ? 'Now' : `0:${left < 10 ? '0' : ''}${left}`
  const hot = hotLook(state.hotName)
  const round = getRoundProgress()
  state.ballText = `Ball ${round.ball}/${round.balls}`
  state.roundScore = fmt(round.score)
  const ceiling = currentCeiling()
  const floor = currentFloor()
  state.multiplierText = ceiling > floor ? `${floor}x to ${ceiling}x` : `${floor}x`
  state.playersText = range.players === 1 ? '1 player here' : `${range.players} players here`
  state.levelText = profile.ready ? `LV ${profile.level}` : 'LV -'
  state.pointsText = profile.ready ? fmt(profile.points) : '-'
  state.toastDisplay = SHOW_CALLOUTS && Date.now() < toastUntil ? 'flex' : 'none'
  const compact = PHONE_COMPACT && onPhone()
  state.perfDisplay = PERF_READOUT && !compact ? 'flex' : 'none'
  // The round multiplier doesn't apply to the tutorial round (it isn't sent to the ledger), so
  // it stays hidden until the tutorial's over. Its 2X hot target lesson uses the hot box instead.
  state.multiplierDisplay = compact || tutorial.active ? 'none' : 'flex'
  state.pointsLabelDisplay = compact ? 'none' : 'flex'
  scale = onPhone() ? PHONE_SCALE : 1
  const cardWidth = z(CARD_WIDTH)
  const rightShift = onPhone() ? -PHONE_RIGHT_SHIFT : 0
  const wind = windReadout()
  state.perfText = `${perfStats.fps} fps  ·  physics ${perfStats.physicsMs} ms`

  // The round icon buttons along the bottom: Leaderboards, Backpack, Settings
  const iconButton = (onPress: () => void, gap: boolean) => ({
    base: {
      uiTransform: {
        width: z(36),
        height: z(36),
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        margin: { left: gap ? z(14) : 0 },
        borderRadius: z(18),
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: onPress
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })
  const backpackButton = useInteraction(iconButton(() => toggleBackpack(), true))

  const boardsButton = useInteraction({
    base: {
      uiTransform: {
        width: z(36),
        height: z(36),
        // It used to stretch to fill the row (the old Leaderboards pill): set it back explicitly,
        // as a property that's just left out can keep its old value
        flexGrow: 0,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: z(18),
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: () => openBoards({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const settingsButton = useInteraction({
    base: {
      uiTransform: {
        width: z(36),
        height: z(36),
        justifyContent: 'center',
        alignItems: 'center',
        margin: { left: z(14) },
        borderRadius: z(18),
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: () => openSettingsPanel({ state, props })
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
        flexDirection: 'column',
        alignItems: 'flex-end',
        padding: { top: onPhone() ? CARD_TOP_PHONE : CARD_TOP, right: 16 },
        pointerFilter: 'none'
      }}
    >
      {/* The card. Every size goes through z(), which scales it up on a phone (PHONE_SCALE). */}
      <UiEntity
        uiTransform={{
          width: cardWidth,
          flexDirection: 'column',
          padding: { top: z(12), right: z(14), bottom: z(12), left: z(14) },
          margin: { right: rightShift },
          borderRadius: z(20),
          borderWidth: 3,
          borderColor: { r: 1, g: 1, b: 1, a: 1 }
        }}
        uiBackground={{ color: { r: 0.957, g: 0.969, b: 0.976, a: 0.95 } }}
      >
        {/* Hot target */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: z(46),
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: { left: z(12), right: z(12) },
            margin: { bottom: z(10) },
            borderRadius: z(14),
            borderWidth: z(2),
            borderColor: hot.rim,
            display: state.hotDisplay
          }}
          uiBackground={{ color: hot.fill }}
        >
          <UiEntity uiTransform={{ width: z(112), height: z(38), flexDirection: 'column' }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="HOT TARGET  2X" fontSize={z(11)} color={faded(hot.text)} textAlign="middle-left" uiTransform={{ width: z(112), height: z(14) }} />
            <Label font="sans-serif" fontSrc={FONT_BOLD} value={state.hotName} fontSize={z(18)} color={hot.text} textAlign="middle-left" uiTransform={{ width: z(112), height: z(24) }} />
          </UiEntity>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value={state.hotTime} fontSize={z(20)} color={hot.text} textAlign="middle-right" uiTransform={{ width: z(64), height: z(30) }} />
        </UiEntity>

        {/* Round */}
        <UiEntity uiTransform={{ width: '100%', height: z(28), flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={state.ballText} fontSize={z(15)} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-left" uiTransform={{ width: z(100), height: z(26) }} />
          <Label font="sans-serif" fontSrc={FONT_BOLD} value={state.roundScore} fontSize={z(18)} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-right" uiTransform={{ width: z(100), height: z(26) }} />
        </UiEntity>

        {/* Wind: the arrow is as you're looking (up = blowing away from you) */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: z(wind.words && !compact ? 44 : 32),
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: { left: z(10), right: z(10) },
            margin: { top: z(6) },
            borderRadius: z(12)
          }}
          uiBackground={{ color: { r: 0.886, g: 0.957, b: 0.882, a: 1 } }}
        >
          <UiEntity uiTransform={{ width: z(130), flexDirection: 'column' }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="WIND" fontSize={z(11)} color={{ r: 0.165, g: 0.525, b: 0.106, a: 1 }} textAlign="middle-left" uiTransform={{ width: z(130), height: z(14) }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR}
              value={wind.words}
              fontSize={z(12)}
              color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
              textAlign="middle-left"
              uiTransform={{ width: z(130), height: z(18), display: wind.words && !compact ? 'flex' : 'none' }}
            />
          </UiEntity>
          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
            {/* The arrow is a picture (wind.ts): the diagonal arrow characters showed as emoji */}
            <UiEntity
              uiTransform={{ width: z(20), height: z(20), margin: { right: z(2) }, display: wind.calm ? 'none' : 'flex' }}
              uiBackground={{ textureMode: 'stretch', texture: { src: wind.arrow || 'assets/images/menus/wind-arrow-0.png' } }}
            />
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={wind.mph} fontSize={z(16)} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-right" uiTransform={{ width: z(50), height: z(24) }} />
          </UiEntity>
        </UiEntity>

        {/* Multiplier */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: z(44),
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: { left: z(10), right: z(10) },
            margin: { top: z(6) },
            borderRadius: z(12),
            display: state.multiplierDisplay
          }}
          uiBackground={{ color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }}
        >
          <UiEntity uiTransform={{ width: z(100), height: z(32), flexDirection: 'column' }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="MULTIPLIER" fontSize={z(11)} color={{ r: 0.075, g: 0.533, b: 0.722, a: 1 }} textAlign="middle-left" uiTransform={{ width: z(100), height: z(14) }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={state.playersText} fontSize={z(12)} color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-left" uiTransform={{ width: z(100), height: z(18) }} />
          </UiEntity>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value={state.multiplierText} fontSize={z(17)} color={{ r: 0.075, g: 0.533, b: 0.722, a: 1 }} textAlign="middle-right" uiTransform={{ width: z(80), height: z(26) }} />
        </UiEntity>

        {/* Level and Pixel Points */}
        <UiEntity uiTransform={{ width: '100%', height: z(30), flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { top: z(8) } }}>
          <UiEntity
            uiTransform={{ width: z(64), height: z(26), justifyContent: 'center', alignItems: 'center', borderRadius: z(13) }}
            uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
          >
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={state.levelText} fontSize={z(13)} color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-center" uiTransform={{ width: z(64), height: z(26) }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: z(136), height: z(26), flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value="Pixel Points" fontSize={z(12)} color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }} textAlign="middle-right" uiTransform={{ width: z(76), height: z(26), display: state.pointsLabelDisplay }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={state.pointsText} fontSize={z(16)} color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }} textAlign="middle-right" uiTransform={{ width: z(60), height: z(26) }} />
          </UiEntity>
        </UiEntity>

        {/* Leaderboards (trophy), Backpack (clubs, balls, stats) and the Settings cog */}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { top: z(10) } }}>
          <UiEntity key="boards-icon" {...boardsButton}>
            <UiEntity
              key="trophy"
              uiTransform={{ width: z(20), height: z(20) }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-trophy.png' } }}
            />
          </UiEntity>
          <UiEntity key="backpack-icon" {...backpackButton}>
            <UiEntity
              uiTransform={{ width: z(20), height: z(20) }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-backpack.png' } }}
            />
          </UiEntity>
          <UiEntity key="settings-icon" {...settingsButton}>
            <UiEntity
              uiTransform={{ width: z(20), height: z(20) }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-settings.png' } }}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>

      {/* Frame rate readout (PERF_READOUT) */}
      <Label font="sans-serif" fontSrc={FONT_REGULAR}
        value={state.perfText}
        fontSize={12}
        color={{ r: 1, g: 1, b: 1, a: 1 }}
        textAlign="middle-right"
        uiTransform={{ width: 240, height: 20, margin: { top: 6 }, display: state.perfDisplay }}
      />

      {/* Callout */}
      <UiEntity
        uiTransform={{
          width: 240,
          minHeight: 40,
          justifyContent: 'center',
          alignItems: 'center',
          padding: { top: 8, right: 12, bottom: 8, left: 12 },
          margin: { top: 10 },
          borderRadius: 16,
          display: state.toastDisplay
        }}
        uiBackground={{ color: { r: 0.165, g: 0.525, b: 0.106, a: 0.95 } }}
      >
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value={state.toastText} fontSize={14} textWrap="wrap" color={{ r: 1, g: 1, b: 1, a: 1 }} textAlign="middle-center" uiTransform={{ width: 216, minHeight: 24 }} />
      </UiEntity>
    </UiEntity>
  )
}
