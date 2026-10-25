/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { meters } from '../game'
import { onPhone } from '../mobile'

export interface State {}
export const state: State = {}

// Pixel Golf colours, as used across the menus
const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE = { r: 0.957, g: 0.969, b: 0.976, a: 0.92 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const TRACK = { r: 0.2, g: 0.24, b: 0.28, a: 0.85 }
const LIVE = { r: 0.36, g: 0.8, b: 0.33, a: 1 }
const MIDDLE = { r: 1, g: 1, b: 1, a: 0.6 }
const TARGET = { r: 1, g: 0.55, b: 0.1, a: 1 }

// Sizes, in UI pixels
const TRACK_W = 220
const TRACK_H = 16
const LABEL_W = 62
const TAG_W = 66
// Distance up from the bottom of the screen. Phones keep it above the joystick and buttons' row.
const BOTTOM_DESKTOP = 110
const BOTTOM_PHONE = 40

/**
 * The swing meters: one small panel low in the middle of the screen, out of the way of the
 * range and the player. A row per meter, shown as it comes into play:
 *   POWER  a fill that rises and falls (green). The tutorial adds an orange target line.
 *   CURVE  a marker that sweeps left and right (green), with the straight-ahead middle marked.
 * When E locks a meter its fill turns blue, stops at the chosen value, and a LOCKED tag
 * appears beside it. Both stay up, locked, through the swing.
 */
export function PowerBar(props: {}) {
  const show = meters.showPower || meters.showCurve
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: { bottom: onPhone() ? BOTTOM_PHONE : BOTTOM_DESKTOP },
        pointerFilter: 'none',
        display: show ? 'flex' : 'none'
      }}
    >
      <UiEntity
        uiTransform={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: { top: 6, bottom: 6, left: 12, right: 12 },
          borderRadius: 14,
          borderWidth: 2,
          borderColor: WHITE
        }}
        uiBackground={{ color: PALE }}
      >
        <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
          <PowerRow />
          <CurveRow />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function LockedTag(props: { locked: boolean }) {
  return (
    <UiEntity uiTransform={{ width: TAG_W, height: 22, justifyContent: 'flex-end', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{
          width: 62,
          height: 20,
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: 10,
          display: props.locked ? 'flex' : 'none'
        }}
        uiBackground={{ color: BLUE }}
      >
        <Label value="LOCKED" fontSize={11} color={WHITE} textAlign="middle-center" uiTransform={{ width: 60, height: 18 }} />
      </UiEntity>
    </UiEntity>
  )
}

function PowerRow() {
  const locked = meters.powerLocked
  const pct = Math.min(100, Math.max(0, meters.power))
  const target = meters.powerTarget
  return (
    <UiEntity
      uiTransform={{
        height: 30,
        flexDirection: 'row',
        alignItems: 'center',
        display: meters.showPower ? 'flex' : 'none'
      }}
    >
      <Label value="POWER" fontSize={13} color={NAVY} textAlign="middle-left" uiTransform={{ width: LABEL_W, height: 22 }} />
      <UiEntity uiTransform={{ width: TRACK_W, height: TRACK_H, padding: 3 }} uiBackground={{ color: TRACK }}>
        <UiEntity uiTransform={{ width: `${pct}%`, height: '100%' }} uiBackground={{ color: locked ? BLUE : LIVE }} />
        {/* The tutorial's target: press E when the fill reaches this line */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { left: `${Math.max(0, target)}%`, top: -5 },
            width: 4,
            height: TRACK_H + 10,
            display: target >= 0 ? 'flex' : 'none'
          }}
          uiBackground={{ color: TARGET }}
        />
      </UiEntity>
      <LockedTag locked={locked} />
    </UiEntity>
  )
}

function CurveRow() {
  const locked = meters.curveLocked
  // The marker is 6% wide, so its left edge runs 0..94%
  const left = (Math.min(100, Math.max(0, meters.curve)) * 94) / 100
  return (
    <UiEntity
      uiTransform={{
        height: 30,
        flexDirection: 'row',
        alignItems: 'center',
        display: meters.showCurve ? 'flex' : 'none'
      }}
    >
      <Label value="CURVE" fontSize={13} color={NAVY} textAlign="middle-left" uiTransform={{ width: LABEL_W, height: 22 }} />
      <UiEntity uiTransform={{ width: TRACK_W, height: TRACK_H, padding: 3 }} uiBackground={{ color: TRACK }}>
        {/* Straight ahead */}
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { left: '50%', top: 0 }, width: 2, height: '100%' }}
          uiBackground={{ color: MIDDLE }}
        />
        <UiEntity uiTransform={{ width: '6%', height: '100%', position: { left: `${left}%` } }} uiBackground={{ color: locked ? BLUE : LIVE }} />
      </UiEntity>
      <LockedTag locked={locked} />
    </UiEntity>
  )
}
