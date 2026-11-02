/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { ballCamEnabled, orbitCamEnabled, promptsEnabled, toggleBallCam, toggleOrbitCam, togglePrompts } from '../game'
import { playUi } from '../sfx'
import { menuReopenBlocked } from '../menuGuard'
import { amIAdmin, sendAdminReset, sendRedeem, onRedeemed, profile } from '../ledger/client'
import { toggleDevPanel, devPanel } from './DevPanel'
import { forTouch } from '../mobile'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'
import { audio, VOLUME_STEPS, toggleMusic, setMusicVolume, toggleVoice, setVoiceVolume } from '../audio'
import { feed, toggleIgnoreFeed } from '../shotFeed'

// The Settings panel, opened by the cog button on the range card (ui/RangeHud.tsx), in tabs:
//   - Visual: Ball cam (only here now: key 1 picks the wedge), Orbit camera, Prompts, and Ignore
//     notifications (the shot feed pills stop popping up: shotFeed.ts)
//   - Audio: Music and Commentary, each with an on/off switch and a volume bar (audio.ts)
//   - Codes: Redeem a code. "Tester" unlocks everything in the shop for this visit (CODES in
//     ledger/server.ts, which checks it)
//   - Developer (admins only, ADMIN in ledger/rules.ts): the Dev panel, and Reset ledger, which
//     takes two presses

export type SettingsTab = 'visual' | 'audio' | 'codes' | 'developer'

export interface State {
  display: 'flex' | 'none'
  /** Which tab is showing */
  tab: SettingsTab
  ballCamOn: boolean
  orbitCamOn: boolean
  promptsOn: boolean
  promptsLabel: string
  promptsText: string
  ballCamLabel: string
  orbitCamLabel: string
  /** Show the admin row. Only decides what's drawn: the server checks the wallet. */
  isAdmin: boolean
  /** The Reset button has been pressed once and is waiting for the second press. */
  resetArmed: boolean
  resetLabel: string
  /** The Settings button: hidden while another menu or card is open, so it never sits on top of one */
  buttonDisplay: 'flex' | 'none'
  /** The rows' explanations, in touch words on a phone */
  ballCamText: string
  orbitCamText: string
  resetText: string
}

// How long the Reset button waits for its second press before it calms down again
const RESET_ARM_MS = 5000
let resetArmedUntil = 0

export const state: State = {
  display: 'none',
  tab: 'visual',
  ballCamOn: true,
  orbitCamOn: false,
  promptsOn: true,
  promptsLabel: 'On',
  promptsText: '',
  ballCamLabel: 'On',
  orbitCamLabel: 'Off',
  isAdmin: false,
  resetArmed: false,
  resetLabel: 'Reset',
  buttonDisplay: 'flex',
  ballCamText: '',
  orbitCamText: '',
  resetText: ''
}

type UiAction = { state: State; props: Parameters<typeof SettingsMenu>[0]; value?: unknown }

// @ui-action
function openSettings({ state, props }: UiAction) {
  if (state.display !== 'flex' && menuReopenBlocked()) return
  state.display = state.display === 'flex' ? 'none' : 'flex'
  playUi(state.display === 'flex' ? 'ui_open' : 'ui_close')
}

/** Opens the Settings panel, or closes it if it's open. The button is on the range card (ui/RangeHud.tsx). */
export function toggleSettings() {
  openSettings({ state, props: {} })
}

// @ui-action
function closeSettings({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_close')
}

// @ui-action
function switchBallCam({ state, props }: UiAction) {
  toggleBallCam()
  playUi('ui_click')
}

// @ui-action
function switchPrompts({ state, props }: UiAction) {
  togglePrompts()
  playUi('ui_click')
}

// @ui-action
function switchOrbitCam({ state, props }: UiAction) {
  toggleOrbitCam()
  playUi('ui_click')
}

// @ui-action
function pressResetLedger({ state, props }: UiAction) {
  // First press arms it, the second (within a few seconds) sends it
  if (!state.resetArmed) {
    resetArmedUntil = Date.now() + RESET_ARM_MS
    playUi('ui_click')
    return
  }
  resetArmedUntil = 0
  sendAdminReset()
  state.display = 'none'
  playUi('ui_close')
}

// ---- Codes ----
/** What's typed in the code box, and the answer to the last code sent */
let codeText = ''
let codeAnswer = { text: '', ok: false }
onRedeemed((r) => {
  codeAnswer = { text: r.message, ok: r.ok }
  playUi(r.ok ? 'ui_select' : 'ui_click')
})

function redeemCode(): void {
  const code = codeText.trim()
  if (!code) return
  codeAnswer = { text: 'Checking...', ok: true }
  sendRedeem(code)
  playUi('ui_click')
}

function showTab(tab: SettingsTab): void {
  if (state.tab === tab) return
  state.tab = tab
  playUi('ui_select')
}

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const GREEN = { r: 0.165, g: 0.525, b: 0.106, a: 1 }
const OFF = { r: 0.765, g: 0.804, b: 0.835, a: 1 }
const PALE_BLUE = { r: 0.62, g: 0.78, b: 0.85, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const EDGE = { r: 0.835, g: 0.863, b: 0.886, a: 1 }

/**
 * A sound row: name and volume on the left, a bar of steps to tap (the slider), and the on/off
 * switch. Tapping a step sets the volume and switches the sound on.
 */
function soundRow(key: string, title: string, on: boolean, step: number, onToggle: () => void, onStep: (n: number) => void) {
  const steps: number[] = []
  for (let i = 1; i <= VOLUME_STEPS; i++) steps.push(i)
  return (
    <UiEntity
      key={key}
      uiTransform={{
        width: '100%',
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { top: 14 },
        padding: { left: 20, right: 18 },
        borderRadius: 20,
        borderWidth: 2,
        borderColor: EDGE
      }}
      uiBackground={{ color: WHITE }}
    >
      <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
        <UiEntity uiTransform={{ width: '100%', height: 28, flexDirection: 'row', alignItems: 'center' }}>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value={title} fontSize={20} color={NAVY} textAlign="middle-left" uiTransform={{ width: 150, height: 28 }} />
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={on ? `${step * 10}%` : 'Muted'} fontSize={14} color={GREY} textAlign="middle-left" uiTransform={{ width: 80, height: 28 }} />
        </UiEntity>
        <UiEntity uiTransform={{ height: 32, flexDirection: 'row', alignItems: 'center', margin: { top: 4 } }}>
          {steps.map((i) => (
            <UiEntity
              key={`${key}-${i}`}
              uiTransform={{ width: 30, height: 32, justifyContent: 'center', alignItems: 'flex-end', padding: { bottom: 6 }, margin: { right: 2 } }}
              onMouseDown={() => {
                onStep(i)
                playUi('ui_click')
              }}
            >
              <UiEntity
                uiTransform={{ width: 26, height: 10 + i, borderRadius: 4 }}
                uiBackground={{ color: i <= step ? (on ? BLUE : PALE_BLUE) : OFF }}
              />
            </UiEntity>
          ))}
        </UiEntity>
      </UiEntity>
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={on ? 'On' : 'Off'} fontSize={14} color={GREY} textAlign="middle-right" uiTransform={{ width: 36, height: 38, margin: { right: 10 } }} />
      <UiEntity
        uiTransform={{
          width: 76,
          height: 38,
          flexDirection: 'row',
          justifyContent: on ? 'flex-end' : 'flex-start',
          alignItems: 'center',
          padding: { left: 4, right: 4 },
          borderRadius: 19
        }}
        uiBackground={{ color: on ? GREEN : OFF }}
        onMouseDown={() => {
          onToggle()
          playUi('ui_click')
        }}
      >
        <UiEntity uiTransform={{ width: 30, height: 30, borderRadius: 15 }} uiBackground={{ color: WHITE }} />
      </UiEntity>
    </UiEntity>
  )
}

/** A tab along the top: blue when it's showing (the same as the Backpack's tabs) */
function tabButton(label: string, tab: SettingsTab, t: ReturnType<typeof useInteraction>) {
  const active = state.tab === tab
  return (
    <UiEntity key={`settings-tab-${tab}`} {...t}>
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={label} fontSize={16} color={active ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width: 112, height: 30 }} />
    </UiEntity>
  )
}

function tabStyle(tab: SettingsTab) {
  const active = state.tab === tab
  return useInteraction(
    {
      base: {
        uiTransform: { width: 118, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, margin: { left: 4, right: 4 } },
        uiBackground: { color: WHITE },
        onMouseDown: () => showTab(tab)
      },
      // Only the tabs not showing light up on hover (on the blue one it washed out the white text)
      hover: active ? undefined : { uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } } },
      active: { uiBackground: { color: BLUE } }
    },
    active
  )
}

export function SettingsMenu(props: {}) {
  // The settings live in game.ts; mirror them here for the switches and labels
  state.ballCamOn = ballCamEnabled
  state.orbitCamOn = orbitCamEnabled
  state.ballCamLabel = ballCamEnabled ? 'On' : 'Off'
  state.orbitCamLabel = orbitCamEnabled ? 'On' : 'Off'
  state.promptsOn = promptsEnabled
  state.promptsLabel = promptsEnabled ? 'On' : 'Off'
  state.promptsText = 'Instructions on screen, like how to set your power. The tutorial always shows them.'
  state.isAdmin = amIAdmin()
  // The Developer tab is only there for admins
  if (state.tab === 'developer' && !state.isAdmin) state.tab = 'visual'
  state.resetArmed = Date.now() < resetArmedUntil
  state.resetLabel = state.resetArmed ? 'Sure?' : 'Reset'
  state.ballCamText = 'Follow the ball after each shot.'
  state.orbitCamText = forTouch('While the ball cam follows a shot: drag or A / D to orbit, W / S to zoom.')
  state.resetText = forTouch(
    state.resetArmed
      ? 'Press again to wipe everyone. This can\'t be undone.'
      : 'Wipes everyone\'s XP, points, bests and leaderboards. Everyone redoes the tutorial.'
  )

  // Every tab's style is worked out every time (it's a hook), the Developer one only drawn for admins
  const visualTab = tabStyle('visual')
  const audioTab = tabStyle('audio')
  const codesTab = tabStyle('codes')
  const developerTab = tabStyle('developer')

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
      onMouseDown: () => closeSettings({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const ballCamSwitch = useInteraction(
    {
      base: {
        uiTransform: {
          width: 76,
          height: 38,
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: { left: 4, right: 4 },
          borderRadius: 19
        },
        uiBackground: { color: { r: 0.765, g: 0.804, b: 0.835, a: 1 } },
        onMouseDown: () => switchBallCam({ state, props })
      },
      active: {
        uiTransform: { justifyContent: 'flex-end' },
        uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } }
      }
    },
    state.ballCamOn
  )

  const orbitCamSwitch = useInteraction(
    {
      base: {
        uiTransform: {
          width: 76,
          height: 38,
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: { left: 4, right: 4 },
          borderRadius: 19
        },
        uiBackground: { color: { r: 0.765, g: 0.804, b: 0.835, a: 1 } },
        onMouseDown: () => switchOrbitCam({ state, props })
      },
      active: {
        uiTransform: { justifyContent: 'flex-end' },
        uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } }
      }
    },
    state.orbitCamOn
  )

  const promptsSwitch = useInteraction(
    {
      base: {
        uiTransform: {
          width: 76,
          height: 38,
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: { left: 4, right: 4 },
          borderRadius: 19
        },
        uiBackground: { color: { r: 0.765, g: 0.804, b: 0.835, a: 1 } },
        onMouseDown: () => switchPrompts({ state, props })
      },
      active: {
        uiTransform: { justifyContent: 'flex-end' },
        uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } }
      }
    },
    state.promptsOn
  )

  const resetButton = useInteraction(
    {
      base: {
        uiTransform: {
          width: 96,
          height: 38,
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: 19,
          borderWidth: 2,
          borderColor: { r: 0.773, g: 0.192, b: 0.192, a: 1 }
        },
        uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
        onMouseDown: () => pressResetLedger({ state, props })
      },
      hover: {
        uiBackground: { color: { r: 0.992, g: 0.902, b: 0.902, a: 1 } }
      },
      active: {
        uiBackground: { color: { r: 0.773, g: 0.192, b: 0.192, a: 1 } }
      }
    },
    state.resetArmed
  )

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        pointerFilter: 'none',
        zIndex: 10
      }}
    >
      {/* Settings panel */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          justifyContent: 'center',
          alignItems: 'center',
          pointerFilter: 'block',
          display: state.display
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
            width: 560,
            height: 548,
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
              borderRadius: { topLeft: 24, topRight: 24 },
              borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
              borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
            }}
            uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
          >
            <UiEntity
              uiTransform={{
                width: 210,
                height: 44,
                alignItems: 'center',
                padding: { left: 26 },
                borderRadius: { topLeft: 24, bottomRight: 22 }
              }}
              uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
            >
              <Label font="sans-serif" fontSrc={FONT_BOLD}
                value="Settings"
                fontSize={19}
                color={{ r: 1, g: 1, b: 1, a: 1 }}
                textAlign="middle-left"
                uiTransform={{ width: 160, height: 30 }}
              />
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

          {/* Tabs */}
          <UiEntity uiTransform={{ width: '100%', height: 64, flexShrink: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
            {tabButton('Visual', 'visual', visualTab)}
            {tabButton('Audio', 'audio', audioTab)}
            {tabButton('Codes', 'codes', codesTab)}
            {state.isAdmin ? tabButton('Developer', 'developer', developerTab) : null}
          </UiEntity>

          {/* Rows */}
          <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', padding: { top: 4, right: 24, bottom: 20, left: 24 } }}>
            {/* ---- Visual ---- */}
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', display: state.tab === 'visual' ? 'flex' : 'none' }}>
            {/* Ball cam */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 88,
                flexDirection: 'row',
                alignItems: 'center',
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
                <Label font="sans-serif" fontSrc={FONT_BOLD}
                  value="Ball cam"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label font="sans-serif" fontSrc={FONT_REGULAR}
                  value={state.ballCamText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label font="sans-serif" fontSrc={FONT_REGULAR}
                value={state.ballCamLabel}
                fontSize={14}
                color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                textAlign="middle-right"
                uiTransform={{ width: 36, height: 38, margin: { right: 10 } }}
              />
              <UiEntity {...ballCamSwitch}>
                <UiEntity
                  uiTransform={{ width: 30, height: 30, borderRadius: 15 }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                />
              </UiEntity>
            </UiEntity>

            {/* Orbit camera */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 88,
                flexDirection: 'row',
                alignItems: 'center',
                margin: { top: 14 },
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
                <Label font="sans-serif" fontSrc={FONT_BOLD}
                  value="Orbit camera"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label font="sans-serif" fontSrc={FONT_REGULAR}
                  value={state.orbitCamText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label font="sans-serif" fontSrc={FONT_REGULAR}
                value={state.orbitCamLabel}
                fontSize={14}
                color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                textAlign="middle-right"
                uiTransform={{ width: 36, height: 38, margin: { right: 10 } }}
              />
              <UiEntity {...orbitCamSwitch}>
                <UiEntity
                  uiTransform={{ width: 30, height: 30, borderRadius: 15 }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                />
              </UiEntity>
            </UiEntity>

            {/* Prompts */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 88,
                flexDirection: 'row',
                alignItems: 'center',
                margin: { top: 14 },
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
                <Label font="sans-serif" fontSrc={FONT_BOLD}
                  value="Prompts"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label font="sans-serif" fontSrc={FONT_REGULAR}
                  value={state.promptsText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label font="sans-serif" fontSrc={FONT_REGULAR}
                value={state.promptsLabel}
                fontSize={14}
                color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                textAlign="middle-right"
                uiTransform={{ width: 36, height: 38, margin: { right: 10 } }}
              />
              <UiEntity {...promptsSwitch}>
                <UiEntity
                  uiTransform={{ width: 30, height: 30, borderRadius: 15 }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                />
              </UiEntity>
            </UiEntity>

            {/* Ignore notifications: on stops the shot feed's pills popping up (they still go in the pull-down list) */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 58,
                flexDirection: 'row',
                alignItems: 'center',
                margin: { top: 14 },
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: EDGE
              }}
              uiBackground={{ color: WHITE }}
            >
              <Label font="sans-serif" fontSrc={FONT_BOLD} value="Ignore notifications" fontSize={20} color={NAVY} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: 28 }} />
              <Label font="sans-serif" fontSrc={FONT_REGULAR} value={feed.ignore ? 'On' : 'Off'} fontSize={14} color={GREY} textAlign="middle-right" uiTransform={{ width: 36, height: 38, margin: { right: 10 } }} />
              <UiEntity
                uiTransform={{
                  width: 76,
                  height: 38,
                  flexDirection: 'row',
                  justifyContent: feed.ignore ? 'flex-end' : 'flex-start',
                  alignItems: 'center',
                  padding: { left: 4, right: 4 },
                  borderRadius: 19
                }}
                uiBackground={{ color: feed.ignore ? GREEN : OFF }}
                onMouseDown={() => {
                  toggleIgnoreFeed()
                  playUi('ui_click')
                }}
              >
                <UiEntity uiTransform={{ width: 30, height: 30, borderRadius: 15 }} uiBackground={{ color: WHITE }} />
              </UiEntity>
            </UiEntity>

            </UiEntity>

            {/* ---- Audio ---- */}
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: -14 }, display: state.tab === 'audio' ? 'flex' : 'none' }}>
              {soundRow('music', 'Music', audio.musicOn, audio.musicVol, toggleMusic, setMusicVolume)}
              {soundRow('voice', 'Commentary', audio.voiceOn, audio.voiceVol, toggleVoice, setVoiceVolume)}
            </UiEntity>

            {/* ---- Codes ---- */}
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', display: state.tab === 'codes' ? 'flex' : 'none' }}>
              <UiEntity
                uiTransform={{ width: '100%', flexDirection: 'column', padding: { top: 16, left: 20, right: 18, bottom: 18 }, borderRadius: 20, borderWidth: 2, borderColor: EDGE }}
                uiBackground={{ color: WHITE }}
              >
                <Label font="sans-serif" fontSrc={FONT_BOLD} value="Redeem a code" fontSize={20} color={NAVY} textAlign="middle-left" uiTransform={{ width: '100%', height: 28 }} />
                <Label
                  font="sans-serif"
                  fontSrc={FONT_REGULAR}
                  value="Got a code? Type it in and press Redeem."
                  fontSize={13}
                  textWrap="wrap"
                  color={GREY}
                  textAlign="top-left"
                  uiTransform={{ width: 460, height: 22, margin: { top: 4 } }}
                />
                <UiEntity uiTransform={{ width: '100%', height: 44, flexDirection: 'row', alignItems: 'center', margin: { top: 10 } }}>
                  {/* Just the explorer's own text box (it draws its own outline: a box round it showed as two) */}
                  <UiEntity uiTransform={{ flexGrow: 1, height: 44, justifyContent: 'center' }}>
                    <Input
                      font="sans-serif"
                      fontSrc={FONT_REGULAR}
                      placeholder="Enter code"
                      fontSize={16}
                      color={NAVY}
                      placeholderColor={{ r: 0.6, g: 0.64, b: 0.68, a: 1 }}
                      textAlign="middle-left"
                      onChange={(v) => (codeText = v)}
                      onSubmit={(v) => {
                        codeText = v
                        redeemCode()
                      }}
                      uiTransform={{ width: '100%', height: 44 }}
                    />
                  </UiEntity>
                  <UiEntity
                    uiTransform={{ width: 110, height: 40, justifyContent: 'center', alignItems: 'center', margin: { left: 12 }, borderRadius: 20 }}
                    uiBackground={{ color: BLUE }}
                    onMouseDown={() => redeemCode()}
                  >
                    <Label font="sans-serif" fontSrc={FONT_BOLD} value="Redeem" fontSize={16} color={WHITE} textAlign="middle-center" uiTransform={{ width: 100, height: 30 }} />
                  </UiEntity>
                </UiEntity>
                <Label
                  font="sans-serif"
                  fontSrc={FONT_REGULAR}
                  value={codeAnswer.text}
                  fontSize={14}
                  textWrap="wrap"
                  color={codeAnswer.ok ? GREEN : { r: 0.773, g: 0.192, b: 0.192, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 460, height: 24, margin: { top: 10 }, display: codeAnswer.text ? 'flex' : 'none' }}
                />
              </UiEntity>
              {/* While the Tester code is on */}
              <Label
                font="sans-serif"
                fontSrc={FONT_REGULAR}
                value="Tester mode is on: everything in the shop is unlocked until you leave."
                fontSize={13}
                textWrap="wrap"
                color={GREY}
                textAlign="middle-left"
                uiTransform={{ width: 500, height: 22, margin: { top: 12 }, display: profile.tester ? 'flex' : 'none' }}
              />
            </UiEntity>

            {/* ---- Developer (admins only) ---- */}
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: -14 }, display: state.tab === 'developer' && state.isAdmin ? 'flex' : 'none' }}>

            {/* Admin: the dev panel (hot target, pretend players, wind). Only drawn for admins */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 58,
                flexDirection: 'row',
                alignItems: 'center',
                margin: { top: 14 },
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.773, g: 0.192, b: 0.192, a: 1 },
                display: state.isAdmin ? 'flex' : 'none'
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <Label font="sans-serif" fontSrc={FONT_BOLD}
                value="Dev panel (admin)"
                fontSize={20}
                color={{ r: 0.773, g: 0.192, b: 0.192, a: 1 }}
                textAlign="middle-left"
                uiTransform={{ flexGrow: 1, height: 28 }}
              />
              <UiEntity
                uiTransform={{
                  width: 96,
                  height: 38,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 19,
                  borderWidth: 2,
                  borderColor: { r: 0.773, g: 0.192, b: 0.192, a: 1 }
                }}
                uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                onMouseDown={() => {
                  // Opens the panel and gets the settings out of the way
                  if (!devPanel.open) toggleDevPanel()
                  state.display = 'none'
                }}
              >
                <Label font="sans-serif" fontSrc={FONT_REGULAR}
                  value="Open"
                  fontSize={15}
                  color={{ r: 0.773, g: 0.192, b: 0.192, a: 1 }}
                  textAlign="middle-center"
                  uiTransform={{ width: 90, height: 30 }}
                />
              </UiEntity>
            </UiEntity>

            {/* Admin: reset the ledger. Only drawn for admins */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 88,
                flexDirection: 'row',
                alignItems: 'center',
                margin: { top: 14 },
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.773, g: 0.192, b: 0.192, a: 1 },
                display: state.isAdmin ? 'flex' : 'none'
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
                <Label font="sans-serif" fontSrc={FONT_BOLD}
                  value="Reset ledger (admin)"
                  fontSize={20}
                  color={{ r: 0.773, g: 0.192, b: 0.192, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label font="sans-serif" fontSrc={FONT_REGULAR}
                  value={state.resetText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <UiEntity {...resetButton}>
                <Label font="sans-serif" fontSrc={FONT_REGULAR}
                  value={state.resetLabel}
                  fontSize={15}
                  color={state.resetArmed ? { r: 1, g: 1, b: 1, a: 1 } : { r: 0.773, g: 0.192, b: 0.192, a: 1 }}
                  textAlign="middle-center"
                  uiTransform={{ width: 90, height: 30 }}
                />
              </UiEntity>
            </UiEntity>
            </UiEntity>
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
