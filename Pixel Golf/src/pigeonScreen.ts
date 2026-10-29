import { engine, Entity, Transform, TextShape, Font, TextAlignMode, MeshRenderer, Material, Animator, GltfContainerLoadingState, LoadingState } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { ZONE_SCORES } from './ledger/rules'
import { FONT_BOLD } from './fonts'

// The pigeons' mini bay (Pidgeon Animation V4.glb, by bay 20) has a little Tee Off panel. This
// puts a working score screen on it, the same as the real bays' (teeOffPanels.ts), scaled down:
// every time the pigeon's ball lands in its animation, the screen shows a made-up result, and
// after ten balls it starts a new round.
//
// The pigeon hits its ball four times in the model's 41.7 second loop (read from the model). To
// keep the screen in step, the animation is started again from the top once the model has
// loaded, and the clock here starts with it.

const MODEL_NAME = 'Pidgeon Animation V4.glb'
const LOOP_SECONDS = 41.667
/** When the ball lands (disappears) in the loop, in seconds */
const LANDINGS = [7.67, 17.12, 26.79, 37.5]
const BALLS = 10
/** After the tenth ball, how long the final score stays up before the screen clears */
const ROUND_HOLD = 6

// The mini panel's black screen, measured from the model (scene coordinates): its centre, the way
// it faces (up the slope towards the pigeon) and its size. It's the big panels' screen at 0.2237
// of the size, so the picture and text slots are the big ones scaled down.
const CENTRE = Vector3.create(107.5245, 33.1037, 161.8265)
const NORMAL = Vector3.normalize(Vector3.create(-0.3494, 0.6988, 0.6242))
const SCALE = 0.2237
const SCREEN = { x: 2.78 * SCALE, y: 1.18 * SCALE }
const LIFT = 0.002
const SCREEN_IMAGE = 'assets/images/menus/bay-screen.png'
const GLOW = 0.6
/** The big screens' text slots (teeOffPanels.ts SLOTS), in their metres */
const SLOTS = {
  bay: { x: -1.0462, y: 0.515, cap: 0.08 },
  score: { x: -0.69, y: -0.0762, cap: 0.225 },
  shots: { x: 0.3475, y: -0.0762, cap: 0.15 },
  last: { x: 1.0375, y: -0.045, cap: 0.09 },
  zone: { x: 1.0375, y: -0.2075, cap: 0.0625 }
}
const INK = Color4.create(0.118, 0.204, 0.259, 1)
const GREY = Color4.create(0.337, 0.388, 0.435, 1)

/** How likely each result is for a pigeon (they're decent, not great). Weights, not percentages. */
const RESULTS: { zone: string; weight: number }[] = [
  { zone: '', weight: 14 }, // a miss
  { zone: 'Bunker', weight: 6 },
  { zone: 'Red', weight: 24 },
  { zone: 'Yellow', weight: 20 },
  { zone: 'Green', weight: 15 },
  { zone: 'Orange', weight: 11 },
  { zone: 'Blue', weight: 6 },
  { zone: 'White', weight: 3 },
  { zone: 'Black', weight: 1 }
]

function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return sign + out
}

/** A made-up result: the zone and its points, scored like a real ball (rounded up to 10) */
function randomResult(): { zone: string; points: number } {
  let r = Math.random() * RESULTS.reduce((t, x) => t + x.weight, 0)
  let zone = ''
  for (const x of RESULTS) {
    r -= x.weight
    if (r <= 0) {
      zone = x.zone
      break
    }
  }
  if (!zone) return { zone: 'Miss', points: 0 }
  const s = ZONE_SCORES[zone]
  return { zone, points: Math.ceil((s.outside + (s.inside - s.outside) * Math.random()) / 10) * 10 }
}

function addText(parent: Entity, slot: { x: number; y: number; cap: number }, colour: Color4, text = ''): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: Vector3.create(slot.x * SCALE, slot.y * SCALE, -0.002) })
  TextShape.create(e, {
    text,
    // TextShape sizes are roughly a tenth of a metre per point, with capitals about 0.72 of that
    fontSize: (slot.cap * SCALE) / 0.072,
    font: Font.F_SANS_SERIF,
    fontSrc: FONT_BOLD,
    textColor: colour,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textWrapping: false
  })
  return e
}

export function setupPigeonScreen(): void {
  // root: on the screen, -Z towards the pigeon, +Y up the slope
  const worldUp = Vector3.Up()
  const up = Vector3.normalize(Vector3.subtract(worldUp, Vector3.scale(NORMAL, Vector3.dot(worldUp, NORMAL))))
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.add(CENTRE, Vector3.scale(NORMAL, LIFT)),
    rotation: Quaternion.lookRotation(Vector3.scale(NORMAL, -1), up)
  })
  const bg = engine.addEntity()
  Transform.create(bg, { parent: root, scale: Vector3.create(SCREEN.x, SCREEN.y, 1) })
  MeshRenderer.setPlane(bg)
  const tex = Material.Texture.Common({ src: SCREEN_IMAGE })
  Material.setPbrMaterial(bg, {
    texture: tex,
    emissiveTexture: tex,
    emissiveColor: Color4.White(),
    emissiveIntensity: GLOW,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0
  })
  addText(root, SLOTS.bay, Color4.White(), 'PIGEON BAY')
  const scoreText = addText(root, SLOTS.score, INK)
  const shotsText = addText(root, SLOTS.shots, INK)
  const lastText = addText(root, SLOTS.last, INK)
  const zoneText = addText(root, SLOTS.zone, GREY)

  let score = 0
  let shot = 0
  const show = (last: string, zone: string) => {
    TextShape.getMutable(scoreText).text = formatNumber(score)
    TextShape.getMutable(shotsText).text = `${shot}/${BALLS}`
    TextShape.getMutable(lastText).text = last
    TextShape.getMutable(zoneText).text = zone
  }
  show('-', '')

  const model = engine.getEntityOrNullByName(MODEL_NAME)
  // Without the model to follow, the clock just runs from now
  let started = !model
  let clock = 0
  let next = 0
  let clearIn = -1

  engine.addSystem((dt) => {
    // Once the model has loaded, start its animation from the top and the clock with it
    if (!started) {
      const loading = GltfContainerLoadingState.getOrNull(model!)
      if (!loading || loading.currentState !== LoadingState.FINISHED) return
      started = true
      const anim = Animator.getMutableOrNull(model!)
      if (anim)
        for (const s of anim.states) {
          s.playing = true
          s.shouldReset = true
        }
      return
    }

    if (clearIn > 0) {
      clearIn -= dt
      if (clearIn <= 0) {
        score = 0
        shot = 0
        show('-', '')
      }
    }

    clock += dt
    const loopTime = clock % LOOP_SECONDS
    const loop = Math.floor(clock / LOOP_SECONDS)
    // Landings since the clock started; `next` is how many have been shown
    const due = loop * LANDINGS.length + LANDINGS.filter((t) => t <= loopTime).length
    while (next < due) {
      next++
      if (shot >= BALLS) {
        // A new round starts with this ball (the old one hadn't cleared yet)
        score = 0
        shot = 0
      }
      const r = randomResult()
      shot++
      score += r.points
      show(r.points === 0 && r.zone === 'Miss' ? '0' : `${r.points >= 0 ? '+' : ''}${formatNumber(r.points)}`, r.zone)
      clearIn = shot >= BALLS ? ROUND_HOLD : -1
    }
  })
}
