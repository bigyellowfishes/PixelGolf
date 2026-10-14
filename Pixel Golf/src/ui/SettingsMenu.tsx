/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { ballCamEnabled, orbitCamEnabled, toggleBallCam, toggleOrbitCam } from '../game'
import { playUi } from '../sfx'
import { amIAdmin, sendAdminReset } from '../ledger/client'
import { forTouch, onPhone, PHONE_RIGHT_SHIFT } from '../mobile'
import { state as gameModeMenu } from './GameModeMenu'
import { state as clubMenu } from './ClubSelectMenu'
import { state as boardsMenu } from './LeaderboardMenu'
import { state as roundCard } from './RoundResult'

// Settings button (top of the screen, under the score) and the Settings panel it opens.
// Holds the Ball cam on/off switch (key 1 still toggles it too) and the Orbit camera switch.
// Admins (ADMIN in ledger/rules.ts) also get a Reset ledger row. It takes two presses.

export interface State {
  display: 'flex' | 'none'
  ballCamOn: boolean
  orbitCamOn: boolean
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
  ballCamOn: true,
  orbitCamOn: false,
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
  state.display = state.display === 'flex' ? 'none' : 'flex'
  playUi(state.display === 'flex' ? 'ui_open' : 'ui_close')
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

export function SettingsMenu(props: {}) {
  // The settings live in game.ts; mirror them here for the switches and labels
  state.ballCamOn = ballCamEnabled
  state.orbitCamOn = orbitCamEnabled
  state.ballCamLabel = ballCamEnabled ? 'On' : 'Off'
  state.orbitCamLabel = orbitCamEnabled ? 'On' : 'Off'
  state.isAdmin = amIAdmin()
  state.resetArmed = Date.now() < resetArmedUntil
  state.resetLabel = state.resetArmed ? 'Sure?' : 'Reset'
  state.ballCamText = forTouch('Follow the ball after each shot. Key 1 also switches it.')
  state.orbitCamText = forTouch('While the ball cam follows a shot: drag or A / D to orbit, W / S to zoom.')
  state.resetText = forTouch(
    state.resetArmed
      ? 'Press again to wipe everyone. This can\'t be undone.'
      : 'Wipes everyone\'s XP, points, bests and leaderboards. Everyone redoes the tutorial.'
  )

  // On a phone the button is just the cog, in the top right corner above the range card
  const compactButton = onPhone()
  const otherOpen =
    gameModeMenu.display === 'flex' ||
    clubMenu.display === 'flex' ||
    boardsMenu.display === 'flex' ||
    roundCard.display === 'flex'
  state.buttonDisplay = otherOpen ? 'none' : 'flex'
  const settingsButton = useInteraction({
    base: {
      uiTransform: {
        width: compactButton ? 48 : 150,
        height: compactButton ? 48 : 38,
        // On a phone, out towards the right edge with the range card (PHONE_RIGHT_SHIFT)
        margin: { right: compactButton ? -PHONE_RIGHT_SHIFT : 0 },
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 19,
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 0.95 } },
      onMouseDown: () => openSettings({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

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
      {/* Settings button, where the Ball cam button used to be */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          // Desktop: top centre, under the score. Phone: top right, lined up with the range card.
          justifyContent: compactButton ? 'flex-end' : 'center',
          alignItems: 'flex-start',
          padding: compactButton ? { top: 20, right: 16 } : { top: 108 },
          pointerFilter: 'none',
          display: state.buttonDisplay
        }}
      >
        <UiEntity {...settingsButton}>
          <UiEntity
            uiTransform={{ width: 20, height: 20 }}
            uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-settings.png' } }}
          />
          <Label
            value="Settings"
            fontSize={15}
            color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
            textAlign="middle-left"
            uiTransform={{ width: 80, height: 30, margin: { left: 8 }, display: compactButton ? 'none' : 'flex' }}
          />
        </UiEntity>
      </UiEntity>

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
            height: state.isAdmin ? 450 : 330,
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
              <Label
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

          {/* Rows */}
          <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', padding: { top: 18, right: 24, bottom: 20, left: 24 } }}>
            {/* Ball cam */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 106,
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
                <Label
                  value="Ball cam"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label
                  value={state.ballCamText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label
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
                height: 106,
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
                <Label
                  value="Orbit camera"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label
                  value={state.orbitCamText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label
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

            {/* Admin: reset the ledger. Only drawn for admins */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 106,
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
                <Label
                  value="Reset ledger (admin)"
                  fontSize={20}
                  color={{ r: 0.773, g: 0.192, b: 0.192, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label
                  value={state.resetText}
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <UiEntity {...resetButton}>
                <Label
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
  )
}
