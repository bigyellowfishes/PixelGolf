import { engine, Transform, TextShape, Font, TextAlignMode, MeshRenderer, Material, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { getAllGames } from './game'
import { SOLO_BAY, TUTORIAL_BAY, solo, tutorial } from './ledger/client'
import { XP } from './ledger/rules'
import { afk } from './afk'
import { FONT_BOLD, FONT_REGULAR } from './fonts'

/**
 * Signs floating up in the air over three areas, in the leaderboards' style (leaderboardScreens.ts):
 * a blue title tab and a white card, always turned to face you (Billboard). The card's lines are
 * live text, so the AFK one's XP rate always matches ledger/rules.ts.
 *   AFK AREA   over the middle of the AFK practice grass (afk.ts)
 *   SOLO BAY   over bay 20's ball
 *   TUTORIAL   over bay 19's ball
 * Each one hides while you're in its area (and comes back when you leave), so it isn't hanging
 * over you while you play. Client only (index.ts calls setupSigns after the games exist).
 *
 * The pictures are assets/images/boards/afk-sign-float.png, solo-sign.png and tutorial-sign.png,
 * all 2400 x 700 px.
 */

/** Board size (m) before SIGN_SCALE, the same shape as the pictures */
const BOARD = { w: 4.8, h: 1.4, px: { w: 2400, h: 700 } }
/** Every sign is drawn this much bigger, picture and text together (1.4 = 40% bigger) */
const SIGN_SCALE = 1.4
/** Where the lines go on the card (px): left edge, and each line's middle and capital height (m) */
const TEXT_X = 1200
const TITLE_LINE = { y: 290, cap: 0.17 }
const SMALL_LINE = { y: 440, cap: 0.1 }
/** Lit like a display, the same as the leaderboards */
const GLOW = 0.6
const NAVY = Color4.create(0.118, 0.204, 0.259, 1)

/** How high the board's middle floats over the ground (m): raised with SIGN_SCALE so the bigger board's bottom edge stays where it was */
const BAY_HEIGHT = 4.2 + ((SIGN_SCALE - 1) * BOARD.h) / 2
const AFK_HEIGHT = 5.5 + ((SIGN_SCALE - 1) * BOARD.h) / 2
/** The bays' signs hide within this distance of the ball (m), as well as while you're playing there */
const BAY_RADIUS = 6

/** The middle of the AFK grass: afk.ts CENTRE, 17 m out at the middle of its quarter ring (225 degrees) */
const AFK_AT = { x: 79.74 + 17 * Math.cos((225 * Math.PI) / 180), y: 35.06, z: 182.33 + 17 * Math.sin((225 * Math.PI) / 180) }

type Sign = { root: ReturnType<typeof engine.addEntity>; hide: () => boolean; hidden: boolean }

function board(at: Vector3, image: string, title: string, line: string): Sign['root'] {
  const root = engine.addEntity()
  Transform.create(root, { position: at, scale: Vector3.create(SIGN_SCALE, SIGN_SCALE, SIGN_SCALE) })
  Billboard.create(root, { billboardMode: BillboardMode.BM_Y })
  const bg = engine.addEntity()
  Transform.create(bg, { parent: root, scale: Vector3.create(BOARD.w, BOARD.h, 1) })
  MeshRenderer.setPlane(bg)
  const tex = Material.Texture.Common({ src: `assets/images/boards/${image}` })
  Material.setPbrMaterial(bg, {
    texture: tex,
    emissiveTexture: tex,
    emissiveColor: Color4.White(),
    emissiveIntensity: GLOW,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0
  })
  for (const [slot, bold, text] of [
    [TITLE_LINE, true, title],
    [SMALL_LINE, false, line]
  ] as const) {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create((TEXT_X / BOARD.px.w - 0.5) * BOARD.w, (0.5 - slot.y / BOARD.px.h) * BOARD.h, -0.006)
    })
    TextShape.create(e, {
      text,
      // TextShape sizes are roughly a tenth of a metre per point, with capitals about 0.72 of that
      fontSize: slot.cap / 0.072,
      font: Font.F_SANS_SERIF,
      fontSrc: bold ? FONT_BOLD : FONT_REGULAR,
      textColor: NAVY,
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT,
      textWrapping: false
    })
  }
  return root
}

/** Whether I'm standing within BAY_RADIUS of a point (on the flat) */
function near(p: { x: number; z: number }): boolean {
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return false
  const dx = me.x - p.x
  const dz = me.z - p.z
  return dx * dx + dz * dz < BAY_RADIUS * BAY_RADIUS
}

export function setupSigns(): void {
  const signs: Sign[] = []

  signs.push({
    root: board(Vector3.create(AFK_AT.x, AFK_AT.y + AFK_HEIGHT, AFK_AT.z), 'afk-sign-float.png', 'Earn XP while away', `${XP.afkPerTick} XP every ${XP.afkTickSeconds} seconds on the grass`),
    hide: () => afk.inside || afk.active,
    hidden: false
  })

  const games = getAllGames()
  const soloGame = games.find((g) => g.bay === SOLO_BAY)
  if (soloGame) {
    const tee = soloGame.teePosition()
    signs.push({
      root: board(Vector3.create(tee.x, tee.y + BAY_HEIGHT, tee.z), 'solo-sign.png', 'Always open', 'Even when every other bay is full'),
      hide: () => solo.joined || near(tee),
      hidden: false
    })
  } else console.log('[signs] no bay 20 ball in the scene, so there is no solo bay sign')

  const tutGame = games.find((g) => g.bay === TUTORIAL_BAY)
  if (tutGame) {
    const tee = tutGame.teePosition()
    signs.push({
      root: board(Vector3.create(tee.x, tee.y + BAY_HEIGHT, tee.z), 'tutorial-sign.png', 'New to Pixel Golf?', 'Learn the basics here'),
      hide: () => tutorial.active || near(tee),
      hidden: false
    })
  } else console.log('[signs] no bay 19 ball in the scene, so there is no tutorial sign')

  // Hidden by shrinking the board away (its picture and text with it)
  engine.addSystem(() => {
    for (const s of signs) {
      const hide = s.hide()
      if (hide === s.hidden) continue
      s.hidden = hide
      Transform.getMutable(s.root).scale = hide ? Vector3.Zero() : Vector3.create(SIGN_SCALE, SIGN_SCALE, SIGN_SCALE)
    }
  })
}
