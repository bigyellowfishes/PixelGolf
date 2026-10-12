import { engine, Entity, Transform, TextShape, Billboard, BillboardMode, Font, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { range, hotSecondsLeft } from './ledger/client'
import { HOT } from './ledger/rules'

// The hot target marker: a big "2X" floating over whichever target is hot right now,
// with the seconds it has left. The server picks the target and rotates it every
// 30 seconds for everyone (ledger/server.ts). It hides until the server has said.

// Height of the "2X" as a share of the target's width, and its limits in metres
const MARKER_SIZE = 0.35
const MARKER_MIN = 2
const MARKER_MAX = 9
// How far above the target the marker floats, in multiples of its own height
const MARKER_LIFT = 1.2
// Gentle bob, in metres and seconds per bob
const BOB_HEIGHT = 0.4
const BOB_SECONDS = 2.4

const HOT_COLOUR = Color4.create(1, 0.55, 0.1, 1)
const OUTLINE = Color4.create(0.2, 0.08, 0, 1)

export function setupHotTargetMarker(zoneEntity: (zone: string) => Entity | undefined): void {
  const marker = engine.addEntity()
  Transform.create(marker, { position: Vector3.create(0, -100, 0) })
  Billboard.create(marker, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(marker, {
    text: '',
    fontSize: 40,
    font: Font.F_SANS_SERIF,
    textColor: HOT_COLOUR,
    outlineColor: OUTLINE,
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_BOTTOM_CENTER,
    textWrapping: false
  })
  // The countdown, under the 2X. Scaled with the marker, so it stays in proportion.
  const timer = engine.addEntity()
  Transform.create(timer, { parent: marker, position: Vector3.create(0, -0.2, 0) })
  TextShape.create(timer, {
    text: '',
    fontSize: 16,
    font: Font.F_SANS_SERIF,
    textColor: Color4.White(),
    outlineColor: OUTLINE,
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_TOP_CENTER,
    textWrapping: false
  })

  let shownZone = ''
  let shownText = ''
  let base = Vector3.create(0, -100, 0)
  let clock = 0

  engine.addSystem((dt) => {
    clock += dt
    const zone = range.hot
    if (zone !== shownZone) {
      shownZone = zone
      const ent = zone ? zoneEntity(zone) : undefined
      const t = ent ? Transform.getOrNull(ent) : null
      if (!t) {
        base = Vector3.create(0, -100, 0)
      } else {
        const width = Math.max(Math.abs(t.scale.x), Math.abs(t.scale.z))
        const height = Math.min(MARKER_MAX, Math.max(MARKER_MIN, width * MARKER_SIZE))
        // Letters are about 0.072 m tall per font size unit
        TextShape.getMutable(marker).fontSize = height / 0.072
        TextShape.getMutable(timer).fontSize = (height * 0.4) / 0.072
        Transform.getMutable(timer).position = Vector3.create(0, -height * 0.15, 0)
        base = Vector3.create(t.position.x, t.position.y + height * MARKER_LIFT, t.position.z)
      }
    }

    const left = hotSecondsLeft()
    const text = shownZone && left > 0 ? `HOT  0:${left < 10 ? '0' : ''}${left}` : ''
    if (text !== shownText) {
      shownText = text
      TextShape.getMutable(marker).text = text ? `${HOT.factor}X` : ''
      TextShape.getMutable(timer).text = text
    }

    const bob = Math.sin((clock / BOB_SECONDS) * Math.PI * 2) * BOB_HEIGHT
    Transform.getMutable(marker).position = text ? Vector3.create(base.x, base.y + bob, base.z) : Vector3.create(0, -100, 0)
  })
}
