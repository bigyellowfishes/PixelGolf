import { CLUB_TYPES, ClubType } from './club'

/**
 * Which club is selected. Kept free of scene code on purpose so index.ts (physics),
 * game.ts (the club in the hand) and clubRack.ts (the clickable rack) can all read
 * it without importing each other.
 */

let selected: ClubType = 'iron'
const listeners: Array<(type: ClubType) => void> = []

export function getSelectedClubType(): ClubType {
  return selected
}

/** Launch power of the selected club, the value the physics bridge scales its impulses by. */
export function getLaunchPower(): number {
  return CLUB_TYPES[selected].launchPower
}

export function selectClub(type: ClubType): void {
  if (type === selected) return
  selected = type
  for (const listener of listeners) listener(type)
}

/** Called whenever the selected club changes. */
export function onClubSelected(listener: (type: ClubType) => void): void {
  listeners.push(listener)
}
