/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, Achievement } from '../ledger/rules'
import { achievements } from '../ledger/client'
import { achievementCount } from '../achievements'
import { playUi } from '../sfx'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// The Achievements menu's Badges tab (ui/LeaderboardMenu.tsx): every achievement (ACHIEVEMENTS in ledger/rules.ts) as its round medal,
// in colour once earned and grey with a padlock until then, and the one picked shows big underneath
// with what earns it and when you got it. It fits the room the backpack gives it: up to 7 across
// and 3 down on desktop, fewer on a phone or a screen held upright (more pages instead).
// The badges are assets/images/badges/<id>.png and <id>-locked.png (from the Claude Design canvas).

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const EDGE = { r: 0.835, g: 0.863, b: 0.886, a: 1 }
const GOLD = { r: 0.851, g: 0.651, b: 0.18, a: 1 }

const MAX_COLUMNS = 7
const MAX_ROWS = 3
const CELL_W = 96
/** Cells can squeeze down to this before a column is dropped */
const MIN_CELL_W = 88
const BADGE = 66
/** Room for a two-line name ("Glutton for Punishment") under the badge */
const NAME_H = 34
/** A cell: padding, badge, gap, name, and its margin below */
const CELL_H = 6 + BADGE + 4 + NAME_H + 6
const CELL_GAP = 6
const DIR = 'assets/images/badges/'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const badgesTab = { page: 0, picked: ACHIEVEMENTS[0].id }

function picture(a: Achievement, size: number) {
  const got = !!achievements.got[a.id]
  return (
    <UiEntity uiTransform={{ width: size, height: size, flexShrink: 0 }} uiBackground={{ textureMode: 'stretch', texture: { src: `${DIR}${a.id}${got ? '' : '-locked'}.png` } }}>
      {got ? null : (
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { right: 0, bottom: 0 }, width: size * 0.34, height: size * 0.34, justifyContent: 'center', alignItems: 'center', borderRadius: size * 0.17 }}
          uiBackground={{ color: WHITE }}
        >
          <UiEntity uiTransform={{ width: size * 0.18, height: size * 0.18 }} uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-lock.png' } }} />
        </UiEntity>
      )}
    </UiEntity>
  )
}

function cell(a: Achievement, w: number) {
  const picked = badgesTab.picked === a.id
  const got = !!achievements.got[a.id]
  const badge = Math.min(BADGE, w - 24)
  return (
    <UiEntity
      key={`badge-${a.id}`}
      uiTransform={{ width: w - 6, height: CELL_H, flexDirection: 'column', alignItems: 'center', padding: { top: 6 }, margin: { left: 3, right: 3, bottom: CELL_GAP }, borderRadius: 14, borderWidth: 2, borderColor: picked ? BLUE : { r: 0, g: 0, b: 0, a: 0 } }}
      uiBackground={{ color: picked ? PALE_BLUE : { r: 0, g: 0, b: 0, a: 0 } }}
      onMouseDown={() => {
        badgesTab.picked = a.id
        playUi('ui_click')
      }}
    >
      {picture(a, badge)}
      <Label
        font="sans-serif"
        fontSrc={FONT_BOLD}
        value={a.name}
        fontSize={11}
        textWrap="wrap"
        color={got ? NAVY : GREY}
        textAlign="middle-center"
        uiTransform={{ width: w - 12, height: NAME_H, margin: { top: 4 + BADGE - badge }, flexShrink: 0 }}
      />
    </UiEntity>
  )
}

function earnedOn(seconds: number): string {
  const d = new Date(seconds * 1000)
  return `Earned ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function pageButton(key: string, label: string, enabled: boolean, onPress: () => void, w = 90) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ width: w, height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 16, borderWidth: 2, borderColor: enabled ? BLUE : EDGE, margin: { left: 8 } }}
      uiBackground={{ color: WHITE }}
      onMouseDown={() => {
        if (!enabled) return
        onPress()
        playUi('ui_click')
      }}
    >
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={label} fontSize={13} color={enabled ? BLUE : GREY} textAlign="middle-center" uiTransform={{ width: w - 6, height: 26 }} />
    </UiEntity>
  )
}

/** width and height: the room inside the backpack for this tab */
export function AchievementsTab(props: { width: number; height: number }) {
  const narrow = props.width < 600
  const detailH = narrow ? 112 : 96
  // As many across and down as fit (at least 3 across and 1 down), each cell no wider than CELL_W
  const columns = Math.max(3, Math.min(MAX_COLUMNS, Math.floor(props.width / MIN_CELL_W)))
  const cellW = Math.min(CELL_W, Math.floor(props.width / columns))
  const gridH = props.height - 42 - detailH - 6
  const rowsDown = Math.max(1, Math.min(MAX_ROWS, Math.floor(gridH / (CELL_H + CELL_GAP))))
  const perPage = columns * rowsDown
  const W = columns * cellW

  const pages = Math.ceil(ACHIEVEMENTS.length / perPage)
  if (badgesTab.page >= pages) badgesTab.page = pages - 1
  const list = ACHIEVEMENTS.slice(badgesTab.page * perPage, (badgesTab.page + 1) * perPage)
  const rows: Achievement[][] = []
  for (let i = 0; i < list.length; i += columns) rows.push(list.slice(i, i + columns))
  const count = achievementCount()
  const picked = ACHIEVEMENTS.find((a) => a.id === badgesTab.picked) ?? ACHIEVEMENTS[0]
  const pickedAt = achievements.got[picked.id]
  // The words beside the big badge: the rest of the panel
  const textW = W - 28 - (narrow ? 64 : 74) - 14

  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center' }}>
      {/* How many, and the pages */}
      <UiEntity uiTransform={{ width: W, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { bottom: 6 } }}>
        <Label
          font="sans-serif"
          fontSrc={FONT_BOLD}
          value={achievements.ready ? `${count.got} of ${count.of} ${narrow ? 'earned' : 'badges earned'}` : narrow ? 'Loading...' : 'Loading your badges...'}
          fontSize={narrow ? 13 : 15}
          color={NAVY}
          textAlign="middle-left"
          uiTransform={{ width: narrow ? W - 156 : 300, height: 30 }}
        />
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
          {narrow ? null : (
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={`Page ${badgesTab.page + 1} of ${pages}`} fontSize={13} color={GREY} textAlign="middle-right" uiTransform={{ width: 90, height: 30 }} />
          )}
          {pageButton('badges-prev', 'Back', badgesTab.page > 0, () => (badgesTab.page -= 1), narrow ? 70 : 90)}
          {pageButton('badges-next', 'Next', badgesTab.page < pages - 1, () => (badgesTab.page += 1), narrow ? 70 : 90)}
        </UiEntity>
      </UiEntity>

      {/* The badges */}
      {rows.map((r, i) => (
        <UiEntity key={`badge-row-${i}`} uiTransform={{ width: W, flexDirection: 'row' }}>
          {r.map((a) => cell(a, cellW))}
        </UiEntity>
      ))}

      {/* The one picked */}
      <UiEntity
        uiTransform={{ width: W, height: detailH, flexDirection: 'row', alignItems: 'center', padding: { left: 14, right: 14 }, margin: { top: 6 }, borderRadius: 18 }}
        uiBackground={{ color: WHITE }}
      >
        {picture(picked, narrow ? 64 : 74)}
        <UiEntity uiTransform={{ width: textW, flexDirection: 'column', margin: { left: 14 } }}>
          <UiEntity uiTransform={{ height: 26, flexDirection: 'row', alignItems: 'center' }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value={picked.name} fontSize={narrow ? 16 : 18} color={NAVY} textAlign="middle-left" uiTransform={{ width: 'auto', height: 26 }} />
            {picked.elite ? (
              <UiEntity uiTransform={{ height: 20, justifyContent: 'center', alignItems: 'center', padding: { left: 8, right: 8 }, margin: { left: 10 }, borderRadius: 10 }} uiBackground={{ color: GOLD }}>
                <Label font="sans-serif" fontSrc={FONT_BOLD} value="ELITE" fontSize={10} color={WHITE} textAlign="middle-center" uiTransform={{ width: 'auto', height: 16 }} />
              </UiEntity>
            ) : null}
          </UiEntity>
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={picked.how} fontSize={narrow ? 13 : 14} textWrap="wrap" color={NAVY} textAlign="middle-left" uiTransform={{ width: textW, height: narrow ? 40 : 22 }} />
          <Label
            font="sans-serif"
            fontSrc={FONT_REGULAR}
            value={pickedAt ? earnedOn(pickedAt) : `Not earned yet  ·  ${ACHIEVEMENT_CATEGORIES[picked.cat]}`}
            fontSize={12}
            color={pickedAt ? BLUE : GREY}
            textAlign="middle-left"
            uiTransform={{ width: textW, height: 20 }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
