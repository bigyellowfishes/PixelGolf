import { engine } from '@dcl/sdk/ecs'
import { sayLine } from './voice'
import { onRoundFinished } from './game'
import { shop } from './shop'
import { myBay, onRoundResult, profile, range, tutorial, TUTORIAL_BAY } from './ledger/client'
import { MULTIPLIER, multiplierFloor } from './ledger/rules'

// The commentator's lines for things that happen around the range rather than in a shot
// (the shot's own lines are said from game.ts). The lines themselves are in voice.ts.
//
//   bay       walking into a bay (or clicking its Tee Off screen)
//   crowd     the same, with enough players in to lift the multiplier
//   shopOpen  the shop opens
//   shopBall  equipping a different ball while the shop is open
//   tutStart  the tutorial begins
//   tutDone   the tutorial's last ball lands
//   round     a round's last ball lands, after that ball's own line
//   pb        the ledger says it's a personal best
//   multiMid  ...or the multiplier beat the crowd minimum
//   multiBig  ...by a lot (BIG_ROLL or more)

/** A roll at least this big (and above the crowd minimum) gets the big multiplier lines */
const BIG_ROLL = 5

export function setupCommentary(): void {
  // The end of a round: queued, so they follow the last ball's line instead of cutting it off
  onRoundFinished((r) => {
    if (r.tutorial) sayLine('tutDone', { queue: true })
    else sayLine('round', { queue: true })
  })

  // The ledger's answer to a round: a personal best beats a good roll
  onRoundResult((r) => {
    if (!r.counted) return
    const floor = multiplierFloor(r.players)
    if (r.personalBest) sayLine('pb', { queue: true })
    else if (r.roll > floor) sayLine(r.roll >= BIG_ROLL ? 'multiBig' : 'multiMid', { queue: true })
  })

  let bay = myBay()
  let tutorialWas = tutorial.active
  let shopWas = shop.open
  let ballWas = profile.equipped.ballVis ?? ''

  engine.addSystem(() => {
    // Into a bay. The tutorial bay has the tutorial's own lines.
    const nowBay = myBay()
    if (nowBay !== bay) {
      bay = nowBay
      if (nowBay !== 0 && nowBay !== TUTORIAL_BAY && !tutorial.active) {
        const crowded = range.players >= MULTIPLIER.step
        if (!(crowded && sayLine('crowd'))) sayLine('bay')
      }
    }

    if (tutorial.active !== tutorialWas) {
      tutorialWas = tutorial.active
      if (tutorial.active) sayLine('tutStart')
    }

    if (shop.open !== shopWas) {
      shopWas = shop.open
      if (shop.open) sayLine('shopOpen')
    }

    const ball = profile.equipped.ballVis ?? ''
    if (ball !== ballWas) {
      // Only a change made in the shop (not the ledger arriving when the scene loads)
      if (shop.open) sayLine('shopBall')
      ballWas = ball
    }
  })
}
