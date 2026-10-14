import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

import { room } from './ledger/room'
import { tutorial, solo } from './ledger/client'
import { ClubType, CLUB_TYPES, RemoteClub, createRemoteClub, setRemoteClub } from './club'

/**
 * Everyone sees everyone's club.
 *
 * Your club lives only on your screen (club.ts). So whenever it comes out, goes away, changes
 * (wedge / iron / driver) or moves between the carry grip and the swing grip, this sends a
 * small clubState to the Multiplayer Server, which passes it to everyone as clubSeen. Each
 * screen keeps a copy of every other player's club in that player's right hand
 * (createRemoteClub). The swing itself is the avatar's scene emote, which other players already
 * see, so the copied club swings with it.
 *
 * Privacy: while you're in the tutorial or the solo bay nobody can see you, so your club is
 * reported as put away; and while you're in either, you don't see anyone else's club.
 */

type Shown = { type: ClubType; show: boolean; swing: boolean }

let lastSent = ''

/** Called every frame by Game.UpdateClubFrame with what the local club is doing. Sends only on change. */
export function reportMyClub(type: ClubType, show: boolean, swing: boolean): void {
  const hidden = tutorial.active || solo.joined
  const s: Shown = { type, show: show && !hidden, swing: swing && show && !hidden }
  const key = `${s.type}|${s.show}|${s.swing}`
  if (key === lastSent) return
  lastSent = key
  void room.send('clubState', s)
}

const states = new Map<string, Shown>()
const remotes = new Map<string, RemoteClub>()

function apply(u: string, present: Set<string> | null): void {
  const st = states.get(u)
  if (!st) return
  // Hidden while you can't see other players, and while their avatar isn't here
  const hideAll = tutorial.active || solo.joined
  const here = present ? present.has(u) : true
  const visible = st.show && !hideAll && here
  let rc = remotes.get(u)
  if (!rc) {
    if (!visible) return
    rc = createRemoteClub(u, st.type)
    remotes.set(u, rc)
  }
  setRemoteClub(rc, st.type, visible, st.swing)
}

function presentPlayers(): Set<string> {
  const out = new Set<string>()
  for (const [, who] of engine.getEntitiesWith(PlayerIdentityData)) if (who.address) out.add(who.address.toLowerCase())
  return out
}

export function setupClubSync(): void {
  room.onMessage('clubSeen', (d) => {
    const u = String(d.u).toLowerCase()
    const me = (getPlayer()?.userId ?? '').toLowerCase()
    if (!u || u === me) return
    const type = (CLUB_TYPES as Record<string, unknown>)[d.type] ? (d.type as ClubType) : 'iron'
    states.set(u, { type, show: !!d.show, swing: !!d.swing })
    apply(u, null)
  })

  // Twice a second: who's actually here, and whether you can see other players right now
  let clock = 0
  engine.addSystem((dt) => {
    clock += dt
    if (clock < 0.5) return
    clock = 0
    const present = presentPlayers()
    for (const u of states.keys()) apply(u, present)
  })
}
