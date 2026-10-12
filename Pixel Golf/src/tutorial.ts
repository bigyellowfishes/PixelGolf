import { engine } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { Vector3 } from '@dcl/sdk/math'

import { Game, onRoundFinished, resetTutorialSteps } from './game'
import { profile, onProfile, tutorial, sendTutorialDone, TUTORIAL_BALLS } from './ledger/client'
import { showToast } from './ui/RangeHud'
import { showTutorialComplete } from './ui/RoundResult'

/**
 * The tutorial round.
 *
 * A player whose ledger doesn't have the tutorial ticked off is placed in bay 19 and plays a
 * short round of TUTORIAL_BALLS there. A miss doesn't count and is taken again. While they do:
 *   - the other bays are closed to them, and bay 19 is closed to everyone who has finished
 *   - other players' shots and bay scores aren't shown to them
 *   - their own shots and scores aren't broadcast either, so bay 19 is private to each player
 *     and never claimed on the server (any number of newcomers can use it at once)
 * When the tenth ball lands the tutorial is ticked off on the ledger, bay 19 is released and the
 * player is free to pick a bay as normal.
 *
 * The rules themselves (bay lock, myBay, hiding other players) live in ledger/client.ts, so
 * game.ts needs no tutorial code of its own. This file only starts and ends it.
 */

// After the tenth ball the player stays put this long to see their score, then bay 19 is cleared
const EXIT_DELAY_SECONDS = 4

// Optional: where to send the player when they leave bay 19, e.g. { x: -215, y: 31, z: 60 }.
// Leave undefined to just release the bay and let them walk off.
const EXIT_POSITION: { x: number; y: number; z: number } | undefined = undefined

// How far behind the ball the player is placed (the range faces +X, see Game's aim limits)
const START_BEHIND_BALL = 1.5

export function setupTutorial(bay19: Game | undefined): void {
  if (!bay19) {
    console.log('[tutorial] no Ball_19 in the scene, so there is no tutorial bay and the tutorial is skipped')
    return
  }

  const maybeBegin = () => {
    if (profile.ready && !profile.tutorialDone && !tutorial.started) begin(bay19)
  }

  // The ledger answers some time after the scene starts, and again later (after rounds, purchases,
  // the daily bonus). `tutorial.started` makes sure only the first answer starts it.
  onProfile(maybeBegin)
  maybeBegin()

  // This is here just to test if needed!
  //begin(bay19)

  // The last ball of the tutorial round has landed
  onRoundFinished((r) => {
    if (tutorial.active) finish(bay19, r.score)
  })
}

function begin(bay19: Game): void {
  tutorial.started = true
  tutorial.active = true
  resetTutorialSteps()
  bay19.newRound()

  const tee = bay19.teePosition()
  const ground = tee.y - 0.1 // the ball sits one radius above the ground
  void movePlayerTo({
    newRelativePosition: Vector3.create(tee.x - START_BEHIND_BALL, ground, tee.z),
    avatarTarget: Vector3.create(tee.x + 10, ground + 1, tee.z),
    cameraTarget: Vector3.create(tee.x + 20, ground, tee.z)
  })

  showToast(`Welcome to Pixel Golf! Land ${TUTORIAL_BALLS} shots on the targets from this bay. Press E by the ball to swing.`, 8)
}

function finish(bay19: Game, score: number): void {
  // Release the bay at once: the player can't swing here again, and the ledger has it saved.
  // The server answers with the tutorial's reward (up to TUTORIAL_LEVEL), which fills in the card.
  tutorial.active = false
  profile.tutorialDone = true
  sendTutorialDone()
  showTutorialComplete(score)

  // Let them see their score for a moment, then clear the bay and (optionally) move them on
  let waited = 0
  const exit = (dt: number) => {
    waited += dt
    if (waited < EXIT_DELAY_SECONDS) return
    engine.removeSystem(exit)
    bay19.newRound()
    if (EXIT_POSITION) {
      void movePlayerTo({
        newRelativePosition: Vector3.create(EXIT_POSITION.x, EXIT_POSITION.y, EXIT_POSITION.z)
      })
    }
  }
  engine.addSystem(exit)
}
