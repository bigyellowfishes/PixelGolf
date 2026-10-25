/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { openPixelGolfMenu } from './GameModeMenu'
import { menuReopenBlocked } from '../menuGuard'
import { requestShotStart } from '../game'
import { ClubType } from '../club'
import { getSelectedClubType, selectClub } from '../clubSelect'
import { playUi } from '../sfx'

// Pixel Golf club select. Opened from the game mode menu's Choose Club button.
// Tee Off hands the chosen club to selectClub(), the same call the club rack uses.

// Stats are out of 10 and only drive the bars here; tune them freely.
// Distance follows each club's launchPower in club.ts (driver 175, iron 125, wedge 75).
const CLUB_INFO: Record<ClubType, {
  name: string
  code: string
  tag: string
  desc: string
  image: string
  position: string
  distance: number
  accuracy: number
  height: number
}> = {
  driver: {
    name: 'Driver',
    code: 'DR',
    tag: 'Long game',
    desc: 'Maximum carry for the far greens. The hardest club to keep straight.',
    image: 'assets/images/menus/club-driver.png',
    position: '1 / 3',
    distance: 10,
    accuracy: 4,
    height: 5
  },
  iron: {
    name: '5 Iron',
    code: '5I',
    tag: 'Mid range',
    desc: 'Your all-rounder. Solid distance with easy control for the middle greens.',
    image: 'assets/images/menus/club-iron.png',
    position: '2 / 3',
    distance: 7,
    accuracy: 6,
    height: 6
  },
  wedge: {
    name: 'Wedge',
    code: 'WG',
    tag: 'Short game',
    desc: 'High, soft and accurate. Drops onto the closest greens and stops near the pin.',
    image: 'assets/images/menus/club-wedge.png',
    position: '3 / 3',
    distance: 4,
    accuracy: 9,
    height: 9
  }
}

export interface State {
  display: 'flex' | 'none'
  selected: ClubType
  driverSelected: boolean
  ironSelected: boolean
  wedgeSelected: boolean
  clubName: string
  clubCode: string
  clubTag: string
  clubDesc: string
  clubImage: string
  clubPosition: string
  distanceWidth: `${number}%`
  distanceValue: string
  accuracyWidth: `${number}%`
  accuracyValue: string
  heightWidth: `${number}%`
  heightValue: string
  playerName: string
  level: number
}

export const state: State = {
  display: 'none',
  selected: 'driver',
  driverSelected: true,
  ironSelected: false,
  wedgeSelected: false,
  clubName: 'Driver',
  clubCode: 'DR',
  clubTag: 'Long game',
  clubDesc: 'Maximum carry for the far greens. The hardest club to keep straight.',
  clubImage: 'assets/images/menus/club-driver.png',
  clubPosition: '1 / 3',
  distanceWidth: '100%',
  distanceValue: '10/10',
  accuracyWidth: '40%',
  accuracyValue: '4/10',
  heightWidth: '50%',
  heightValue: '5/10',
  playerName: 'Player',
  level: 1
}

type UiAction = { state: State; props: Parameters<typeof ClubSelectMenu>[0]; value?: unknown }

function showClub(s: State, type: ClubType) {
  const info = CLUB_INFO[type]
  s.selected = type
  s.driverSelected = type === 'driver'
  s.ironSelected = type === 'iron'
  s.wedgeSelected = type === 'wedge'
  s.clubName = info.name
  s.clubCode = info.code
  s.clubTag = info.tag
  s.clubDesc = info.desc
  s.clubImage = info.image
  s.clubPosition = info.position
  s.distanceWidth = `${info.distance * 10}%`
  s.distanceValue = `${info.distance}/10`
  s.accuracyWidth = `${info.accuracy * 10}%`
  s.accuracyValue = `${info.accuracy}/10`
  s.heightWidth = `${info.height * 10}%`
  s.heightValue = `${info.height}/10`
}

/** Opens the club select with the player's current club highlighted. */
export function openClubSelect(playerName?: string, level?: number) {
  if (state.display !== 'flex' && menuReopenBlocked()) return
  if (playerName !== undefined) state.playerName = playerName
  if (level !== undefined) state.level = level
  showClub(state, getSelectedClubType())
  state.display = 'flex'
}

// @ui-action
function pickDriver({ state, props }: UiAction) {
  playUi('ui_click')
  showClub(state, 'driver')
}

// @ui-action
function pickIron({ state, props }: UiAction) {
  playUi('ui_click')
  showClub(state, 'iron')
}

// @ui-action
function pickWedge({ state, props }: UiAction) {
  playUi('ui_click')
  showClub(state, 'wedge')
}

// @ui-action
function teeOff({ state, props }: UiAction) {
  selectClub(state.selected)
  state.display = 'none'
  playUi('tee_off')
  // Straight into the shot: no walking to the ball and pressing E
  requestShotStart(0, true)
}

// @ui-action
function backToModes({ state, props }: UiAction) {
  state.display = 'none'
  openPixelGolfMenu()
}

// @ui-action
function closeMenu({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_close')
}

export function ClubSelectMenu(props: {}) {
  const closeButton = useInteraction({
    base: {
      uiTransform: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 22,
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: () => closeMenu({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const driverCard = useInteraction(
    {
      base: {
        uiTransform: {
          height: 124,
          flexGrow: 1,
          flexDirection: 'row',
          alignItems: 'center',
          padding: { left: 18, right: 18 },
          borderRadius: 24,
          borderWidth: 2,
          borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
        },
        uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
        onMouseDown: () => pickDriver({ state, props })
      },
      hover: {
        uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } }
      },
      active: {
        uiTransform: { borderWidth: 3, borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
        uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
      }
    },
    state.driverSelected
  )

  const ironCard = useInteraction(
    {
      base: {
        uiTransform: {
          height: 124,
          flexGrow: 1,
          flexDirection: 'row',
          alignItems: 'center',
          margin: { left: 16 },
          padding: { left: 18, right: 18 },
          borderRadius: 24,
          borderWidth: 2,
          borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
        },
        uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
        onMouseDown: () => pickIron({ state, props })
      },
      hover: {
        uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } }
      },
      active: {
        uiTransform: { borderWidth: 3, borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
        uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
      }
    },
    state.ironSelected
  )

  const wedgeCard = useInteraction(
    {
      base: {
        uiTransform: {
          height: 124,
          flexGrow: 1,
          flexDirection: 'row',
          alignItems: 'center',
          margin: { left: 16 },
          padding: { left: 18, right: 18 },
          borderRadius: 24,
          borderWidth: 2,
          borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
        },
        uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
        onMouseDown: () => pickWedge({ state, props })
      },
      hover: {
        uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } }
      },
      active: {
        uiTransform: { borderWidth: 3, borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
        uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
      }
    },
    state.wedgeSelected
  )

  const modesButton = useInteraction({
    base: {
      uiTransform: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        padding: { left: 4, right: 16 },
        borderRadius: 28
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 0 } },
      onMouseDown: () => backToModes({ state, props })
    },
    hover: {
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const teeOffButton = useInteraction({
    base: {
      uiTransform: {
        width: 190,
        height: 56,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        margin: { left: 16 },
        borderRadius: 28,
        borderWidth: 3,
        borderColor: { r: 0.11, g: 0.369, b: 0.078, a: 1 }
      },
      uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } },
      onMouseDown: () => teeOff({ state, props })
    },
    hover: {
      uiBackground: { color: { r: 0.239, g: 0.659, b: 0.169, a: 1 } }
    },
    press: {
      uiBackground: { color: { r: 0.137, g: 0.451, b: 0.102, a: 1 } }
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
        zIndex: 10,
        display: state.display
      }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0 } }}
    >
      {/* The dim behind the menu. Oversized and pinned outside this box, because on a phone the box is
          only the safe area, and a dim that stops at its edges shows as a dark rectangle */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: 'block' }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.45 } }}
      />
      {/* Panel */}
      <UiEntity
        uiTransform={{
          width: 1120,
          height: 630,
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
            height: 76,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: { right: 24 },
            borderRadius: { topLeft: 24, topRight: 24 },
            borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity
            uiTransform={{
              width: 290,
              height: 48,
              alignItems: 'center',
              padding: { left: 32 },
              borderRadius: { topLeft: 24, bottomRight: 24 }
            }}
            uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
          >
            <Label
              value="Choose a Club"
              fontSize={20}
              color={{ r: 1, g: 1, b: 1, a: 1 }}
              textAlign="middle-left"
              uiTransform={{ width: 240, height: 30 }}
            />
          </UiEntity>
          <UiEntity uiTransform={{ height: 74, flexDirection: 'row', alignItems: 'center' }}>
            {/* Level chip */}
            <UiEntity
              uiTransform={{
                height: 40,
                flexDirection: 'row',
                alignItems: 'center',
                padding: { left: 5, right: 14 },
                margin: { right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity
                uiTransform={{
                  width: 58,
                  height: 28,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 14,
                  borderWidth: 2,
                  borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 }
                }}
                uiBackground={{ color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }}
              >
                <Label
                  value="LV"
                  fontSize={10}
                  color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                  textAlign="middle-right"
                  uiTransform={{ width: 18, height: 24 }}
                />
                <Label
                  value={`${state.level}`}
                  fontSize={15}
                  font="monospace"
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 26, height: 24, margin: { left: 3 } }}
                />
              </UiEntity>
              <Label
                value={state.playerName}
                fontSize={14}
                color={{ r: 0.227, g: 0.275, b: 0.322, a: 1 }}
                textAlign="middle-left"
                uiTransform={{ width: 'auto', height: 28, margin: { left: 8 } }}
              />
            </UiEntity>
            <UiEntity
              uiTransform={{ width: 42, height: 56 }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/logo.png' } }}
            />
            <UiEntity
              uiTransform={{ width: 193, height: 28, margin: { left: 12 } }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/wordmark.png' } }}
            />
            <UiEntity
              uiTransform={{ width: 2, height: 36, margin: { left: 18, right: 18 } }}
              uiBackground={{ color: { r: 0.835, g: 0.863, b: 0.886, a: 1 } }}
            />
            <UiEntity {...closeButton}>
              <UiEntity
                uiTransform={{ width: 18, height: 18 }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }}
              />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Body */}
        <UiEntity
          uiTransform={{
            width: '100%',
            flexGrow: 1,
            flexDirection: 'column',
            padding: { top: 22, right: 32, bottom: 18, left: 32 }
          }}
        >
          {/* Hero row */}
          <UiEntity uiTransform={{ width: '100%', height: 280, flexDirection: 'row' }}>
            {/* Showcase */}
            <UiEntity
              uiTransform={{
                width: 400,
                height: '100%',
                padding: 6,
                borderRadius: 28,
                borderWidth: 3,
                borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity
                uiTransform={{ width: '100%', height: '100%', borderRadius: 22 }}
                uiBackground={{ color: { r: 0.918, g: 0.973, b: 0.996, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{
                    width: 230,
                    height: 230,
                    positionType: 'absolute',
                    position: { top: 16, left: 76 },
                    borderRadius: 115,
                    borderWidth: 3,
                    borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 0.35 }
                  }}
                />
                <UiEntity
                  uiTransform={{
                    width: 190,
                    height: 190,
                    positionType: 'absolute',
                    position: { top: 36, left: 96 },
                    borderRadius: 95
                  }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                />
                <UiEntity
                  uiTransform={{
                    width: 200,
                    height: 200,
                    positionType: 'absolute',
                    position: { top: 31, left: 91 }
                  }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: state.clubImage } }}
                />
                <Label
                  value={state.clubCode}
                  fontSize={40}
                  font="monospace"
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="bottom-left"
                  uiTransform={{
                    width: 120,
                    height: 48,
                    positionType: 'absolute',
                    position: { bottom: 12, left: 16 }
                  }}
                />
                <Label
                  value={state.clubPosition}
                  fontSize={14}
                  font="monospace"
                  color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                  textAlign="bottom-right"
                  uiTransform={{
                    width: 80,
                    height: 20,
                    positionType: 'absolute',
                    position: { bottom: 16, right: 16 }
                  }}
                />
              </UiEntity>
            </UiEntity>

            {/* Info card */}
            <UiEntity
              uiTransform={{
                flexGrow: 1,
                height: '100%',
                flexDirection: 'column',
                margin: { left: 22 },
                padding: { top: 22, right: 26, bottom: 22, left: 26 },
                borderRadius: 28,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ width: '100%', height: 48, flexDirection: 'row', alignItems: 'center' }}>
                <Label
                  value={state.clubName}
                  fontSize={36}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 'auto', height: 48 }}
                />
                <UiEntity
                  uiTransform={{ height: 30, padding: { left: 12, right: 12 }, margin: { left: 14 }, borderRadius: 15 }}
                  uiBackground={{ color: { r: 0.902, g: 0.965, b: 0.992, a: 1 } }}
                >
                  <Label
                    value={state.clubTag}
                    fontSize={14}
                    color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                    textAlign="middle-center"
                    uiTransform={{ width: 'auto', height: 30 }}
                  />
                </UiEntity>
              </UiEntity>
              <Label
                value={state.clubDesc}
                fontSize={15}
                textWrap="wrap"
                color={{ r: 0.29, g: 0.341, b: 0.388, a: 1 }}
                textAlign="top-left"
                uiTransform={{ width: '100%', height: 46, margin: { top: 8 } }}
              />

              {/* Distance */}
              <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center', margin: { top: 14 } }}>
                <Label
                  value="Distance"
                  fontSize={15}
                  color={{ r: 0.227, g: 0.275, b: 0.322, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 130, height: 24 }}
                />
                <UiEntity
                  uiTransform={{ flexGrow: 1, height: 14, borderRadius: 4 }}
                  uiBackground={{ color: { r: 0.882, g: 0.91, b: 0.929, a: 1 } }}
                >
                  <UiEntity
                    uiTransform={{ width: state.distanceWidth, height: '100%', borderRadius: 4 }}
                    uiBackground={{ color: { r: 0.122, g: 0.651, b: 0.855, a: 1 } }}
                  />
                </UiEntity>
                <Label
                  value={state.distanceValue}
                  fontSize={15}
                  font="monospace"
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-right"
                  uiTransform={{ width: 64, height: 24 }}
                />
              </UiEntity>

              {/* Accuracy */}
              <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center', margin: { top: 12 } }}>
                <Label
                  value="Accuracy"
                  fontSize={15}
                  color={{ r: 0.227, g: 0.275, b: 0.322, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 130, height: 24 }}
                />
                <UiEntity
                  uiTransform={{ flexGrow: 1, height: 14, borderRadius: 4 }}
                  uiBackground={{ color: { r: 0.882, g: 0.91, b: 0.929, a: 1 } }}
                >
                  <UiEntity
                    uiTransform={{ width: state.accuracyWidth, height: '100%', borderRadius: 4 }}
                    uiBackground={{ color: { r: 0.247, g: 0.651, b: 0.165, a: 1 } }}
                  />
                </UiEntity>
                <Label
                  value={state.accuracyValue}
                  fontSize={15}
                  font="monospace"
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-right"
                  uiTransform={{ width: 64, height: 24 }}
                />
              </UiEntity>

              {/* Launch height */}
              <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center', margin: { top: 12 } }}>
                <Label
                  value="Launch height"
                  fontSize={15}
                  color={{ r: 0.227, g: 0.275, b: 0.322, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 130, height: 24 }}
                />
                <UiEntity
                  uiTransform={{ flexGrow: 1, height: 14, borderRadius: 4 }}
                  uiBackground={{ color: { r: 0.882, g: 0.91, b: 0.929, a: 1 } }}
                >
                  <UiEntity
                    uiTransform={{ width: state.heightWidth, height: '100%', borderRadius: 4 }}
                    uiBackground={{ color: { r: 0.941, g: 0.643, b: 0.11, a: 1 } }}
                  />
                </UiEntity>
                <Label
                  value={state.heightValue}
                  fontSize={15}
                  font="monospace"
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-right"
                  uiTransform={{ width: 64, height: 24 }}
                />
              </UiEntity>
            </UiEntity>
          </UiEntity>

          {/* Club cards */}
          <UiEntity
            uiTransform={{ width: '100%', height: 132, flexDirection: 'row', alignItems: 'flex-end', margin: { top: 18 } }}
          >
            <UiEntity {...driverCard}>
              <UiEntity
                uiTransform={{
                  width: 84,
                  height: 84,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 42,
                  borderWidth: 2,
                  borderColor: { r: 0.882, g: 0.91, b: 0.929, a: 1 }
                }}
                uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 64, height: 64 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/club-driver.png' } }}
                />
              </UiEntity>
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column', margin: { left: 16 } }}>
                <Label
                  value="DR"
                  fontSize={14}
                  font="monospace"
                  color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 18 }}
                />
                <Label
                  value="Driver"
                  fontSize={24}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 32 }}
                />
                <Label
                  value="Long game"
                  fontSize={13}
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 18 }}
                />
              </UiEntity>
            </UiEntity>

            <UiEntity {...ironCard}>
              <UiEntity
                uiTransform={{
                  width: 84,
                  height: 84,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 42,
                  borderWidth: 2,
                  borderColor: { r: 0.882, g: 0.91, b: 0.929, a: 1 }
                }}
                uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 64, height: 64 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/club-iron.png' } }}
                />
              </UiEntity>
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column', margin: { left: 16 } }}>
                <Label
                  value="5I"
                  fontSize={14}
                  font="monospace"
                  color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 18 }}
                />
                <Label
                  value="5 Iron"
                  fontSize={24}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 32 }}
                />
                <Label
                  value="Mid range"
                  fontSize={13}
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 18 }}
                />
              </UiEntity>
            </UiEntity>

            <UiEntity {...wedgeCard}>
              <UiEntity
                uiTransform={{
                  width: 84,
                  height: 84,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 42,
                  borderWidth: 2,
                  borderColor: { r: 0.882, g: 0.91, b: 0.929, a: 1 }
                }}
                uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 64, height: 64 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/club-wedge.png' } }}
                />
              </UiEntity>
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column', margin: { left: 16 } }}>
                <Label
                  value="WG"
                  fontSize={14}
                  font="monospace"
                  color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 18 }}
                />
                <Label
                  value="Wedge"
                  fontSize={24}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 32 }}
                />
                <Label
                  value="Short game"
                  fontSize={13}
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 18 }}
                />
              </UiEntity>
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Footer */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 84,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: { left: 32, right: 32 },
            borderRadius: { bottomLeft: 24, bottomRight: 24 },
            borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity {...modesButton}>
            <UiEntity
              uiTransform={{
                width: 48,
                height: 48,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 24,
                borderWidth: 2,
                borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity
                uiTransform={{ width: 20, height: 20 }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-back.png' } }}
              />
            </UiEntity>
            <Label
              value="Modes"
              fontSize={17}
              color={{ r: 0.227, g: 0.275, b: 0.322, a: 1 }}
              textAlign="middle-left"
              uiTransform={{ width: 70, height: 28, margin: { left: 12 } }}
            />
          </UiEntity>
          <UiEntity uiTransform={{ height: 60, flexDirection: 'row', alignItems: 'center' }}>
            <UiEntity
              uiTransform={{
                height: 52,
                flexDirection: 'row',
                alignItems: 'center',
                padding: { left: 12, right: 18 },
                borderRadius: 26,
                borderWidth: 2,
                borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity
                uiTransform={{ width: 28, height: 28 }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/ball-classic.png' } }}
              />
              <Label
                value="Ball: Classic"
                fontSize={16}
                color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                textAlign="middle-left"
                uiTransform={{ width: 'auto', height: 28, margin: { left: 10 } }}
              />
            </UiEntity>
            <UiEntity {...teeOffButton}>
              <Label
                value="Tee Off"
                fontSize={22}
                color={{ r: 1, g: 1, b: 1, a: 1 }}
                textAlign="middle-center"
                uiTransform={{ width: 100, height: 30 }}
              />
              <UiEntity
                uiTransform={{ width: 20, height: 20, margin: { left: 6 } }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-arrow.png' } }}
              />
            </UiEntity>
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
