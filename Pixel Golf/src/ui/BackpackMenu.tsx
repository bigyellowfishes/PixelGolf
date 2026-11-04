/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { profile, equipCosmetic } from '../ledger/client'
import { CATALOGUE, Cosmetic, CosmeticKind, HAT_COLOURS, HAT_STYLES, NO_HAT, itemById } from '../ledger/rules'
import { openHatFit } from './HatFitPanel'
import { CLUB_TYPES, ClubType } from '../club'
import { getSelectedClubType, selectClub } from '../clubSelect'
import { clubChangeAllowed } from '../game'
import { playUi } from '../sfx'
import { menuReopenBlocked } from '../menuGuard'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'
import { screenRoom } from './screenRoom'

// The backpack: everything you carry, from the backpack button on the range card (ui/RangeHud.tsx).
//   - Balls: the ball looks and ball types you own, to equip (the same as Equip in the shop)
//   - Hat: pick a Pixel Golf hat, and Adjust fit to move or size it (ui/HatFitPanel.tsx, on the
//     right of the screen so you can see your avatar; closing it comes back here)
//   - Clubs: wedge, iron or driver, the same as keys 1, 2 and 3 (and only when they'd work)
// Badges and Stats moved to the Achievements menu, with the leaderboards (the trophy button,
// ui/LeaderboardMenu.tsx), 2026-11-03.
// It's a menu like the others: F closes it, and no shot starts while it's open (index.ts).
// It shrinks to fit a smaller screen (a phone, or one held upright): the tabs narrow, the Balls
// columns stack and the club cards shrink (screenRoom.ts).

export type BackpackTab = 'balls' | 'hat' | 'clubs'
export const state = { display: 'none' as 'flex' | 'none', tab: 'balls' as BackpackTab }

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const BLUE_LIGHT = { r: 0.161, g: 0.694, b: 0.898, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }
const PANEL = { r: 0.957, g: 0.969, b: 0.976, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const EDGE = { r: 0.835, g: 0.863, b: 0.886, a: 1 }
const GREEN = { r: 0.165, g: 0.525, b: 0.106, a: 1 }

const WIDTH = 720
const HEIGHT = 700
/** Narrower than this, the Balls columns stack and the tabs and padding tighten */
const NARROW = 660
const CLUB_ORDER: ClubType[] = ['wedge', 'iron', 'driver']
const CLUB_KEY: Record<ClubType, number> = { wedge: 1, iron: 2, driver: 3 }

/** Opens the backpack, or closes it if it's open. */
export function toggleBackpack(): void {
  if (state.display === 'flex') {
    state.display = 'none'
    playUi('ui_close')
    return
  }
  if (menuReopenBlocked()) return
  state.display = 'flex'
  playUi('ui_open')
}

function closeBackpack(): void {
  state.display = 'none'
  playUi('ui_close')
}

function showTab(tab: BackpackTab): void {
  if (state.tab === tab) return
  state.tab = tab
  playUi('ui_select')
}

function equip(item: Cosmetic): void {
  equipCosmetic(item.id)
  playUi('ui_click')
}

function pickClub(type: ClubType): void {
  if (getSelectedClubType() === type || !clubChangeAllowed()) {
    playUi('ui_click')
    return
  }
  selectClub(type)
  playUi('ui_select')
}

function tabButton(label: string, tab: BackpackTab, w: number, narrow: boolean) {
  const active = state.tab === tab
  const t = useInteraction(
    {
      base: {
        uiTransform: { width: w, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, margin: { left: narrow ? 3 : 6, right: narrow ? 3 : 6 } },
        uiBackground: { color: WHITE },
        onMouseDown: () => showTab(tab)
      },
      // Only the tabs not showing light up on hover (on the blue one it washed out the white text)
      hover: active ? undefined : { uiBackground: { color: PALE_BLUE } },
      active: { uiBackground: { color: BLUE } }
    },
    active
  )
  return (
    <UiEntity {...t}>
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={label} fontSize={narrow ? 14 : 16} color={active ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width: w - 6, height: 30 }} />
    </UiEntity>
  )
}

/** One owned item: its name, and Equip or Equipped */
function itemRow(item: Cosmetic) {
  const on = profile.equipped[item.kind] === item.id
  return (
    <UiEntity
      key={item.id}
      uiTransform={{ width: '100%', height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 14, right: 8 }, margin: { bottom: 6 }, borderRadius: 14, borderWidth: on ? 2 : 0, borderColor: GREEN }}
      uiBackground={{ color: WHITE }}
    >
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={item.name} fontSize={15} color={NAVY} textAlign="middle-left" uiTransform={{ width: 180, height: 30 }} />
      <UiEntity
        uiTransform={{ width: 100, height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 16, borderWidth: 2, borderColor: on ? GREEN : BLUE }}
        uiBackground={{ color: on ? GREEN : WHITE }}
        onMouseDown={() => {
          if (!on) equip(item)
        }}
      >
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value={on ? 'Equipped' : 'Equip'} fontSize={14} color={on ? WHITE : BLUE} textAlign="middle-center" uiTransform={{ width: 96, height: 28 }} />
      </UiEntity>
    </UiEntity>
  )
}

function ownedOf(kind: CosmeticKind): Cosmetic[] {
  return CATALOGUE.filter((i) => i.kind === kind && !i.shelved && profile.owned.indexOf(i.id) >= 0)
}

function itemColumn(title: string, kind: CosmeticKind) {
  const items = ownedOf(kind)
  return (
    <UiEntity uiTransform={{ width: 318, flexDirection: 'column' }}>
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={title} fontSize={12} color={BLUE} textAlign="middle-left" uiTransform={{ width: 318, height: 24, margin: { bottom: 6 } }} />
      {items.length
        ? items.map((i) => itemRow(i))
        : [<Label key="none" font="sans-serif" fontSrc={FONT_REGULAR} value="None yet: the shopkeepers have some" fontSize={14} color={GREY} textAlign="middle-left" uiTransform={{ width: 318, height: 30 }} />]}
    </UiEntity>
  )
}

function clubCard(type: ClubType, w: number) {
  const on = getSelectedClubType() === type
  const k = w / 196
  return (
    <UiEntity
      key={type}
      uiTransform={{ width: w, height: Math.round(250 * k), flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: { left: 6, right: 6 }, borderRadius: 22, borderWidth: on ? 3 : 2, borderColor: on ? BLUE_LIGHT : EDGE }}
      uiBackground={{ color: on ? PALE_BLUE : WHITE }}
      onMouseDown={() => pickClub(type)}
    >
      <UiEntity uiTransform={{ width: Math.round(120 * k), height: Math.round(120 * k) }} uiBackground={{ textureMode: 'stretch', texture: { src: `assets/images/menus/club-${type}.png` } }} />
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={CLUB_TYPES[type].label} fontSize={k < 0.85 ? 18 : 22} color={NAVY} textAlign="middle-center" uiTransform={{ width: w - 16, height: 32, margin: { top: Math.round(10 * k) } }} />
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={on ? 'In your hands' : `Key ${CLUB_KEY[type]}`} fontSize={k < 0.85 ? 12 : 14} color={on ? BLUE : GREY} textAlign="middle-center" uiTransform={{ width: w - 16, height: 22 }} />
    </UiEntity>
  )
}

// --- The Hat tab: which hat, and where it sits ----------------------------------

function wearHat(item: Cosmetic): void {
  if (profile.equipped.hat === item.id) return
  // Only hats you own: buying is done in the shop (hats cost Pixel Points), never by accident here
  if (profile.owned.indexOf(item.id) < 0) return
  equipCosmetic(item.id)
  playUi('ui_click')
}

function hatSwatch(item: Cosmetic, rgb: { r: number; g: number; b: number }) {
  const on = profile.equipped.hat === item.id
  return (
    <UiEntity
      key={`bp-${item.id}`}
      uiTransform={{ width: 28, height: 28, margin: { left: 3 }, justifyContent: 'center', alignItems: 'center', borderRadius: 14, borderWidth: on ? 3 : 2, borderColor: on ? BLUE : EDGE }}
      uiBackground={{ color: on ? PALE_BLUE : WHITE }}
      onMouseDown={() => wearHat(item)}
    >
      <UiEntity uiTransform={{ width: on ? 16 : 18, height: on ? 16 : 18, borderRadius: 9 }} uiBackground={{ color: { ...rgb, a: profile.owned.indexOf(item.id) >= 0 ? 1 : 0.25 } }} />
    </UiEntity>
  )
}

/** No hat: a swatch like the colours, with a strike through it */
function noHatSwatch() {
  const none = itemById(NO_HAT)
  const on = !profile.equipped.hat || profile.equipped.hat === NO_HAT
  return (
    <UiEntity
      key="bp-hat-none"
      uiTransform={{ width: 28, height: 28, margin: { left: 3 }, justifyContent: 'center', alignItems: 'center', borderRadius: 14, borderWidth: on ? 3 : 2, borderColor: on ? BLUE : EDGE }}
      uiBackground={{ color: on ? PALE_BLUE : WHITE }}
      onMouseDown={() => {
        if (none && !on) wearHat(none)
      }}
    >
      <UiEntity uiTransform={{ width: 20, height: 20 }} uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-nohat.png' } }} />
    </UiEntity>
  )
}

function hatTab() {
  const item = itemById(profile.equipped.hat || NO_HAT)
  const wearing = item && item.id !== NO_HAT
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center' }}>
      {/* Which hat */}
      <UiEntity uiTransform={{ width: 318, flexDirection: 'column' }}>
        <Label font="sans-serif" fontSrc={FONT_BOLD} value="YOUR HAT" fontSize={12} color={BLUE} textAlign="middle-left" uiTransform={{ width: 318, height: 24, margin: { bottom: 6 } }} />
        {HAT_STYLES.map((s) => (
          <UiEntity key={`bps-${s.id}`} uiTransform={{ width: '100%', height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 12, right: 6 }, margin: { bottom: 6 }, borderRadius: 14 }} uiBackground={{ color: WHITE }}>
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={s.name} fontSize={14} color={NAVY} textAlign="middle-left" uiTransform={{ width: 74, height: 30 }} />
            <UiEntity uiTransform={{ flexDirection: 'row' }}>
              {HAT_COLOURS.map((c) => {
                const it = itemById(`hat-${s.id}-${c.id}`)
                return it ? hatSwatch(it, c.rgb) : null
              })}
            </UiEntity>
          </UiEntity>
        ))}
        {/* No hat: one struck-through swatch, lined up under the first colour */}
        <UiEntity uiTransform={{ width: '100%', height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: { left: 12, right: 6 }, margin: { bottom: 6 }, borderRadius: 14 }} uiBackground={{ color: WHITE }}>
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value="No hat" fontSize={14} color={NAVY} textAlign="middle-left" uiTransform={{ width: 74, height: 30 }} />
          <UiEntity uiTransform={{ width: HAT_COLOURS.length * 31, flexDirection: 'row' }}>{noHatSwatch()}</UiEntity>
        </UiEntity>
        <UiEntity
          uiTransform={{ width: '100%', height: 40, margin: { top: 8 }, justifyContent: 'center', alignItems: 'center', borderRadius: 20, borderWidth: 2, borderColor: wearing ? BLUE : EDGE }}
          uiBackground={{ color: wearing ? BLUE : WHITE }}
          onMouseDown={() => {
            if (wearing) openHatFit()
          }}
        >
          <Label font="sans-serif" fontSrc={FONT_BOLD} value="Adjust fit" fontSize={15} color={wearing ? WHITE : GREY} textAlign="middle-center" uiTransform={{ width: 200, height: 30 }} />
        </UiEntity>
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value={wearing ? `Wearing the ${item!.name}` : 'No hat on'} fontSize={13} color={GREY} textAlign="middle-left" uiTransform={{ width: 318, height: 26, margin: { top: 8 } }} />
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value="Faded colours are in the shop." fontSize={12} color={GREY} textAlign="middle-left" uiTransform={{ width: 318, height: 20 }} />
      </UiEntity>

    </UiEntity>
  )
}

export function BackpackMenu(props: {}) {
  const closeButton = useInteraction({
    base: {
      uiTransform: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, borderWidth: 2, borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 } },
      uiBackground: { color: WHITE },
      onMouseDown: () => closeBackpack()
    },
    hover: { uiTransform: { borderColor: BLUE_LIGHT }, uiBackground: { color: PALE_BLUE } }
  })

  // Fit the screen: never bigger than WIDTH x HEIGHT, and 12px clear of each edge
  const room = screenRoom()
  const width = Math.min(WIDTH, room.w - 24)
  const height = Math.min(HEIGHT, room.h - 24)
  const narrow = width < NARROW
  const pad = narrow ? 12 : 24
  const tabW = Math.min(150, Math.floor((width - 16) / 3) - (narrow ? 6 : 12))
  // The room inside for the tab showing (less the frame, header, tabs and padding)
  const innerW = width - 8 - pad * 2
  const innerH = height - 8 - 64 - 64 - 18
  const clubW = Math.min(196, Math.floor((innerW - 36) / 3))

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block', zIndex: 10 }}
    >
      {/* The dim behind it, oversized like the other menus' so it covers a phone's whole screen */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: 'block' }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.35 } }}
        // Clicking outside the panel (the backpack button included) closes it
        onMouseDown={() => closeBackpack()}
      />
      <UiEntity
        uiTransform={{ width, height, flexDirection: 'column', borderRadius: 28, borderWidth: 4, borderColor: WHITE, overflow: 'hidden' }}
        uiBackground={{ color: PANEL }}
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
            borderColor: EDGE
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity uiTransform={{ width: 210, height: 44, alignItems: 'center', padding: { left: 26 }, borderRadius: { topLeft: 24, bottomRight: 22 } }} uiBackground={{ color: BLUE }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="Backpack" fontSize={19} color={WHITE} textAlign="middle-left" uiTransform={{ width: 160, height: 30 }} />
          </UiEntity>
          <UiEntity uiTransform={{ height: 62, alignItems: 'center' }}>
            <UiEntity {...closeButton}>
              <UiEntity uiTransform={{ width: 16, height: 16 }} uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }} />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Tabs */}
        <UiEntity uiTransform={{ width: '100%', height: 64, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
          {tabButton('Balls', 'balls', tabW, narrow)}
          {tabButton('Hat', 'hat', tabW, narrow)}
          {tabButton('Clubs', 'clubs', tabW, narrow)}
        </UiEntity>

        {/* The tab showing */}
        <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', padding: { left: pad, right: pad, bottom: 18 } }}>
          {state.tab === 'balls' ? (
            <UiEntity uiTransform={{ width: '100%', flexDirection: narrow ? 'column' : 'row', justifyContent: 'space-between', alignItems: narrow ? 'center' : 'flex-start' }}>
              {itemColumn('COSMETIC', 'ballVis')}
              {itemColumn('EFFECTS', 'ballProp')}
            </UiEntity>
          ) : null}
          {state.tab === 'hat' ? hatTab() : null}
          {state.tab === 'clubs' ? (
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', margin: { top: narrow ? 16 : 40 } }}>
              <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center' }}>{CLUB_ORDER.map((c) => clubCard(c, clubW))}</UiEntity>
              <Label
                font="sans-serif"
                fontSrc={FONT_REGULAR}
                value={clubChangeAllowed() ? 'Pick the club for your next shot.' : 'You can change club before your next shot.'}
                fontSize={14}
                color={GREY}
                textAlign="middle-center"
                uiTransform={{ width: innerW, height: 30, margin: { top: 24 } }}
              />
            </UiEntity>
          ) : null}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
