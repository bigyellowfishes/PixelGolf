import { Storage } from '@dcl/sdk/server'

/**
 * The ledger's epoch: which admin reset we're on. Server only.
 *
 * Player storage is addressed by wallet and the server has no list of every wallet, so a
 * reset can't go round deleting records. Instead every key the ledger stores under carries
 * the epoch (epochKey), and a reset is one write: a new epoch. From then on the server reads
 * and writes fresh keys, and everything from before is never looked at again.
 *
 * That also makes it safe against writes already on their way when the button was pressed:
 * they land on the old keys. And if the epoch ever can't be read, the server falls back to
 * the old keys, which shows old progress for that run rather than overwriting anyone's.
 *
 * 0 means never reset, and keeps the keys exactly as they were (pg2, pg-leaders2).
 */

const KEY = 'pg-epoch'

let epoch = 0
let ready: Promise<void> | null = null

async function read(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stored = await Storage.get<string>(KEY)
      const n = Number(stored)
      epoch = Number.isFinite(n) && n > 0 ? n : 0
      console.log(`[ledger] epoch ${epoch}`)
      return
    } catch (e) {
      console.log(`[ledger] epoch read failed (attempt ${attempt}): ${e}`)
    }
  }
  console.log('[ledger] epoch could not be read, so going on as 0')
}

/** Resolves once the epoch is known. Everything that reads storage waits on this. */
export function epochReady(): Promise<void> {
  if (!ready) ready = read()
  return ready
}

export function currentEpoch(): number {
  return epoch
}

/** A storage key for the current epoch: the base key itself until the first reset. */
export function epochKey(base: string): string {
  return epoch > 0 ? `${base}-e${epoch}` : base
}

/** Starts a new epoch. False if it couldn't be saved, in which case nothing has changed. */
export async function bumpEpoch(): Promise<boolean> {
  await epochReady()
  const next = Math.max(epoch + 1, Math.floor(Date.now() / 1000))
  let ok = false
  try {
    ok = (await Storage.set(KEY, String(next))) !== false
  } catch (e) {
    console.log(`[ledger] epoch save failed: ${e}`)
  }
  if (ok) epoch = next
  return ok
}
