/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { shop, closeShop } from '../shop'
import { profile, buyCosmetic, equipCosmetic } from '../ledger/client'
import { CATALOGUE, Cosmetic, CosmeticKind } from '../ledger/rules'
import { playUi } from '../sfx'
import { onPhone } from '../mobile'

// The pro shop. Opens by itself when you walk up to a shopkeeper and closes when you walk off
// (src/shop.ts). Lists the catalogue in ledger/rules.ts, one tab per kind: buy with Pixel Points,
// equip what you own. The server does the real checks (level, price, wallet) and sends the
// ledger back, which updates this; anything it refuses shows as a notice at the bottom.
//
// It sits in the middle of the screen, with no dim behind it, so you can still see around it and
// walk away (which closes it).

// Pixel Golf colours, as used across the menus
const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }
const PALE = { r: 0.957, g: 0.969, b: 0.976, a: 0.97 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const RIM = { r: 0.788, g: 0.827, b: 0.859, a: 1 }
const GREEN = { r: 0.165, g: 0.525, b: 0.106, a: 1 }
const ORANGE = { r: 1, g: 0.549, b: 0.102, a: 1 }
const CLEAR = { r: 1, g: 1, b: 1, a: 0 }

const WIDTH = 400
const WIDTH_PHONE = 470

function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

// @ui-action
function showAisle(kind: CosmeticKind) {
  if (shop.aisle === kind) return
  shop.aisle = kind
  shop.notice = ''
  playUi('ui_click')
}

// @ui-action
function buy(item: Cosmetic) {
  shop.notice = ''
  buyCosmetic(item.id)
  playUi('ui_click')
}

// @ui-action
function equip(item: Cosmetic) {
  equipCosmetic(item.id)
  playUi('ui_click')
}

// A tab: blue when it's the one showing
function tab(label: string, kind: CosmeticKind, width: number) {
  const active = shop.aisle === kind
  const t = useInteraction(
    {
      base: {
        uiTransform: { width, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18 },
        uiBackground: { color: WHITE },
        onMouseDown: () => showAisle(kind)
      },
      hover: { uiBackground: { color: PALE_BLUE } },
      active: { uiBackground: { color: BLUE } }
    },
    active
  )
  return (
    <UiEntity {...t}>
      <Label value={label} fontSize={14} color={active ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width, height: 30 }} />
    </UiEntity>
  )
}

// What a row's right-hand side says and does, for this player right now
type RowAction = { label: string; fill: typeof BLUE; text: typeof BLUE; border: typeof BLUE; onClick?: () => void }

function rowAction(item: Cosmetic): RowAction {
  const owned = profile.owned.indexOf(item.id) >= 0
  if (owned && profile.equipped[item.kind] === item.id) return { label: 'Equipped', fill: GREEN, text: WHITE, border: GREEN }
  if (owned) return { label: 'Equip', fill: WHITE, text: BLUE, border: BLUE, onClick: () => equip(item) }
  if (profile.level < item.level) return { label: `Level ${item.level}`, fill: CLEAR, text: GREY, border: RIM }
  const afford = profile.points >= item.price
  return {
    label: item.price > 0 ? `${fmt(item.price)} PP` : 'Free',
    fill: afford ? BLUE : CLEAR,
    text: afford ? WHITE : GREY,
    border: afford ? BLUE : RIM,
    // Not enough points: still clickable, so the server's answer says how many more are needed
    onClick: () => buy(item)
  }
}

export function ShopMenu(props: {}) {
  const phone = onPhone()
  const width = phone ? WIDTH_PHONE : WIDTH
  const items = CATALOGUE.filter((i) => i.kind === shop.aisle && !i.shelved)
  const notice = Date.now() < shop.noticeUntil ? shop.notice : ''

  const closeButton = useInteraction({
    base: {
      uiTransform: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18, borderWidth: 2, borderColor: RIM },
      uiBackground: { color: WHITE },
      onMouseDown: () => closeShop()
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: PALE_BLUE }
    }
  })

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        pointerFilter: 'none',
        display: shop.open ? 'flex' : 'none',
        zIndex: 12
      }}
    >
      <UiEntity
        uiTransform={{
          width,
          flexDirection: 'column',
          padding: { top: 14, right: 16, bottom: 16, left: 16 },
          borderRadius: 24,
          borderWidth: 3,
          borderColor: WHITE,
          pointerFilter: 'block'
        }}
        uiBackground={{ color: PALE }}
      >
        {/* Header: title, your points, close */}
        <UiEntity uiTransform={{ width: '100%', height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label value="Pro Shop" fontSize={22} color={NAVY} textAlign="middle-left" uiTransform={{ width: 140, height: 36 }} />
          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
            <UiEntity
              uiTransform={{ height: 30, padding: { left: 12, right: 12 }, margin: { right: 10 }, justifyContent: 'center', alignItems: 'center', borderRadius: 15 }}
              uiBackground={{ color: PALE_BLUE }}
            >
              <Label value={profile.ready ? `${fmt(profile.points)} PP` : '- PP'} fontSize={15} color={BLUE} textAlign="middle-center" uiTransform={{ height: 26 }} />
            </UiEntity>
            <UiEntity {...closeButton}>
              <Label value="X" fontSize={16} color={NAVY} textAlign="middle-center" uiTransform={{ width: 30, height: 30 }} />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* What the shopkeeper said */}
        <Label
          value={`${shop.keeper}: ${shop.greeting}`}
          fontSize={13}
          color={GREY}
          textWrap="wrap"
          textAlign="middle-left"
          uiTransform={{ width: width - 32, minHeight: 20, margin: { top: 2, bottom: 10 } }}
        />

        {/* Tabs */}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: 10 } }}>
          {tab('Balls', 'ball', (width - 40) / 2)}
          {tab('Clubs', 'club', (width - 40) / 2)}
        </UiEntity>

        {/* The aisle */}
        {items.map((item) => {
          const a = rowAction(item)
          return (
            <UiEntity
              key={`shop-${item.id}`}
              uiTransform={{
                width: '100%',
                height: 52,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: { left: 14, right: 8 },
                margin: { top: 6 },
                borderRadius: 14,
                borderWidth: 2,
                borderColor: WHITE
              }}
              uiBackground={{ color: WHITE }}
            >
              <UiEntity uiTransform={{ flexDirection: 'column' }}>
                <Label value={item.name} fontSize={16} color={NAVY} textAlign="middle-left" uiTransform={{ width: width - 180, height: 22 }} />
                <Label
                  value={item.price > 0 ? `Unlocks at level ${item.level}` : item.level > 1 ? `Free at level ${item.level}` : 'Free'}
                  fontSize={11}
                  color={GREY}
                  textAlign="middle-left"
                  uiTransform={{ width: width - 180, height: 16 }}
                />
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: 108,
                  height: 34,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 17,
                  borderWidth: 2,
                  borderColor: a.border,
                  pointerFilter: a.onClick ? 'block' : 'none'
                }}
                uiBackground={{ color: a.fill }}
                onMouseDown={a.onClick}
              >
                <Label value={a.label} fontSize={14} color={a.text} textAlign="middle-center" uiTransform={{ width: 104, height: 28 }} />
              </UiEntity>
            </UiEntity>
          )
        })}

        {/* Why a buy didn't go through */}
        <UiEntity
          uiTransform={{
            width: '100%',
            minHeight: 36,
            justifyContent: 'center',
            alignItems: 'center',
            padding: { top: 6, bottom: 6, left: 10, right: 10 },
            margin: { top: 10 },
            borderRadius: 12,
            display: notice ? 'flex' : 'none'
          }}
          uiBackground={{ color: ORANGE }}
        >
          <Label value={notice} fontSize={13} color={WHITE} textWrap="wrap" textAlign="middle-center" uiTransform={{ width: width - 52, minHeight: 22 }} />
        </UiEntity>

        <Label
          value="Looks only: nothing here changes how your ball flies."
          fontSize={11}
          color={GREY}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 18, margin: { top: 10 } }}
        />
      </UiEntity>
    </UiEntity>
  )
}
