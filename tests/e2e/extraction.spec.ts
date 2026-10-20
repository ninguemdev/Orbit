import { type Page, expect, test } from '@playwright/test';
import { CREW, EXTRACTION, SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { closeOpenContexts, signUpInNewContext } from './support/accounts';

test.afterEach(closeOpenContexts);

const HULL = SHIP_HULLS[ShipHullId.Scout];
const SPEED_LIMIT = HULL.handling.maxSpeed * EXTRACTION.maxSpeedFraction;
// The CI job this runs in (.github/workflows/ci.yml, "Multiplayer com dois navegadores")
// is capped at 25 real minutes, and setup plus the other 11 specs already use about 3 of
// those — a budget the external kill enforces regardless of what Playwright's own
// test.setTimeout says, and without a clean error. So the two missions below, worst case
// (every attempt of both exhausting its own flight deadline), must fit well inside the
// remainder. A normal flight was measured taking up to ~90s (potential-field steering
// through a dense, ~60-asteroid sector is not a straight line), so this has real slack
// above that, not just above the theoretical straight-line minimum.
const FLIGHT_DEADLINE_MS = 150_000;
// A hostile seed is accepted game variance (see runMission), not a bug, so a failed
// flight retries with a fresh sector; bounded so a run of bad luck still terminates (and
// stays inside the CI job budget above: see FLIGHT_DEADLINE_MS).
const MAX_ATTEMPTS = 3;
// Slack per attempt beyond the flight itself: ready-up, confirm, walk to the helm, the
// evacuation wait, and the menu transition. Keeps this above the retry loop's own worst
// case so a pathological run surfaces runMission's diagnostic error instead of a bare
// Playwright timeout — itself still well inside the CI job budget above.
const PER_ATTEMPT_OVERHEAD_MS = 30_000;
test.setTimeout(2 * MAX_ATTEMPTS * (FLIGHT_DEADLINE_MS + PER_ATTEMPT_OVERHEAD_MS));

interface ShipState {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly operatorId: string;
}
interface MissionWorld {
  readonly ship: ShipState;
  readonly crew: Record<string, { readonly x: number; readonly y: number }>;
}
interface Zone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

const world = (page: Page) =>
  page.evaluate(() => window.__orbit?.latest() as MissionWorld | null | undefined);
const layout = (page: Page) =>
  page.evaluate(
    () =>
      window.__orbit?.layout() as
        { extractionZones: Zone[]; asteroids: readonly Zone[] } | null | undefined,
  );
const sessionId = (page: Page) => page.evaluate(() => window.__orbit?.sessionId ?? '');

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Readiness names the revision on screen; a click right after a change may be stale. */
async function ensureReady(page: Page) {
  const notReady = page.getByRole('button', { name: 'Estou pronto' });
  if (!(await notReady.isVisible().catch(() => false))) return;
  await expect(async () => {
    await notReady.click();
    await expect(page.getByRole('button', { name: 'Não estou pronto' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
}

/** Waits until two readings of the authoritative position agree: the member stopped. */
async function untilStill(page: Page, id: string) {
  const read = async () => (await world(page))?.crew[id];
  let last = await read();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = await read();
    if (!last || !now) return;
    if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) return;
    last = now;
  }
}

/**
 * Walks the pilot's own crew member to a ship-local target with key pulses (same
 * technique as tests/e2e/mission-loot.spec.ts): holding a key while polling overshoots
 * on a slow CI, so each pulse learns the extra movement of the last one. Waits for the
 * authoritative position to settle before measuring it — on a slow CI the server's
 * stop can land after the key is released, and measuring too early would understate
 * the overshoot and undercorrect the next pulse.
 */
async function walkTo(page: Page, target: { x: number; y: number }, arrivedRadius: number) {
  const id = await sessionId(page);
  await page.locator('canvas').click({ position: { x: 640, y: 30 } });
  let extraMs = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await world(page);
    const self = state?.crew[id];
    if (!state || !self) throw new Error('estado ausente');
    const local = { x: target.x - self.x, y: target.y - self.y };
    const distance = Math.hypot(local.x, local.y);
    if (distance < arrivedRadius) return;
    const angle = state.ship.angle;
    const screen = {
      x: (local.x * Math.cos(angle) - local.y * Math.sin(angle)) / distance,
      y: (local.x * Math.sin(angle) + local.y * Math.cos(angle)) / distance,
    };
    const keys: string[] = [];
    if (screen.x > 0.38) keys.push('KeyD');
    if (screen.x < -0.38) keys.push('KeyA');
    if (screen.y > 0.38) keys.push('KeyS');
    if (screen.y < -0.38) keys.push('KeyW');
    const wantedMs = (distance / CREW.walkSpeed) * 1000 * 0.7;
    const holdMs = Math.min(500, Math.max(30, wantedMs - extraMs));
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    for (const key of keys) await page.keyboard.up(key);
    await untilStill(page, id);
    const after = (await world(page))?.crew[id];
    if (!after) throw new Error('estado ausente');
    const movedMs = (Math.hypot(after.x - self.x, after.y - self.y) / CREW.walkSpeed) * 1000;
    if (movedMs > holdMs) extraMs = movedMs - holdMs;
  }
  throw new Error('não chegou ao destino');
}

/**
 * Pilots the ship to the extraction zone. The server only guarantees *some* route
 * exists between asteroids (found by grid search), not that a straight line is clear,
 * so steering combines three things every 100ms:
 *  - attraction to the zone and repulsion from nearby asteroids, blended as same-scale
 *    unit vectors (the raw distance-to-goal vector would otherwise swamp the repulsion
 *    far from it);
 *  - a forward-looking speed cap, tied to clearance directly ahead, as the actual
 *    safety net — independent of how well the steering reacted this instant;
 *  - a stall escape: if distance-to-goal hasn't improved in 6s (a potential-field local
 *    minimum against one obstacle), turn hard for 3s before resuming normal steering.
 * Returns 'reached' once in the zone under the evacuation speed limit, 'disconnected'
 * if the mission state disappears first (ship destroyed, server-side mission timeout —
 * the real one is 20 minutes, not this function's budget), or 'gave-up' if this
 * function's own patience runs out while the mission is still active — the caller must
 * then actively leave, since the server will otherwise keep the mission running.
 */
async function flyToZone(
  page: Page,
  zone: Zone,
  asteroids: readonly Zone[],
): Promise<'reached' | 'disconnected' | 'gave-up'> {
  const fitRadius = zone.radius - HULL.handling.radius;
  let thrustKey: 'KeyW' | 'KeyS' | null = null;
  let turnKey: 'KeyA' | 'KeyD' | null = null;
  const setKey = async (key: string, down: boolean) => {
    if (down) await page.keyboard.down(key);
    else await page.keyboard.up(key);
  };
  const release = async () => {
    if (thrustKey) await setKey(thrustKey, false);
    if (turnKey) await setKey(turnKey, false);
    thrustKey = null;
    turnKey = null;
  };

  let bestDistance = Infinity;
  let bestDistanceAt = Date.now();
  let escapeUntil = 0;
  let escapeTurn: 1 | -1 = 1;
  const deadline = Date.now() + FLIGHT_DEADLINE_MS;

  try {
    for (;;) {
      if (Date.now() > deadline) return 'gave-up';
      const state = await world(page);
      if (!state) return 'disconnected';
      const { x, y, angle, vx, vy } = state.ship;
      const dx = zone.x - x;
      const dy = zone.y - y;
      const distance = Math.hypot(dx, dy);
      const speed = Math.hypot(vx, vy);
      // Comfortably inside the zone and nearly stopped, not merely under the limit at
      // this instant: residual velocity otherwise keeps carrying the ship in a straight
      // line and can drift it back out (or over the limit) during the 10s evacuation
      // countdown, which cancels it — see the cancellation handling in runMission.
      if (distance <= fitRadius * 0.7 && speed <= SPEED_LIMIT * 0.5) {
        await release();
        return 'reached';
      }

      let wantThrust: 1 | -1 | 0;
      let wantTurn: 1 | -1 | 0;
      const now = Date.now();
      if (distance < bestDistance - 150) {
        bestDistance = distance;
        bestDistanceAt = now;
      } else if (now - bestDistanceAt > 6000 && now >= escapeUntil) {
        escapeUntil = now + 3000;
        escapeTurn = escapeTurn === 1 ? -1 : 1;
        bestDistanceAt = now;
      }
      // The ahead-gap scan (and the speed cap it drives) always runs, escaping or not:
      // escape used to steer blindly on a fixed heading for a full 3s with no braking at
      // all, which a dense field (dozens of asteroids) punished repeatedly — the hull
      // ground down over many corrections, stuck escaping the same cluster, because nothing
      // slowed the ship down while it blindly turned past a neighbour. A wider margin than
      // the offline-tuned value, and over a wider arc than "directly ahead" too: a real
      // browser round-trip per decision runs well past the nominal 100ms wait below (worse
      // yet on CI), so a close neighbour can become ahead by the time the next correction
      // lands.
      let aimX = dx / distance;
      let aimY = dy / distance;
      let aheadGap = Infinity;
      for (const asteroid of asteroids) {
        const adx = asteroid.x - x;
        const ady = asteroid.y - y;
        const adist = Math.hypot(adx, ady);
        const danger = asteroid.radius + HULL.handling.radius + 1800;
        if (adist > 0 && adist < danger) {
          const weight = ((danger - adist) / danger) ** 2 * 1.5;
          aimX += (-adx / adist) * weight;
          aimY += (-ady / adist) * weight;
        }
        if (adist > 4500) continue;
        const bearing = Math.atan2(ady, adx);
        if (Math.abs(wrapAngle(bearing - angle)) > 1.0) continue;
        const gap = adist - asteroid.radius - HULL.handling.radius;
        if (gap < aheadGap) aheadGap = gap;
      }
      const approaching = distance < fitRadius + 2500;
      const speedCap = Math.min(
        HULL.handling.maxSpeed * 0.85,
        Math.max(60, aheadGap - 350),
        approaching ? SPEED_LIMIT * 1.3 : Infinity,
      );

      if (now < escapeUntil) {
        wantTurn = escapeTurn;
        const escapeSpeedCap = Math.min(speedCap, HULL.handling.maxSpeed * 0.45);
        wantThrust =
          speed < Math.min(escapeSpeedCap, HULL.handling.maxSpeed * 0.3)
            ? 1
            : speed > escapeSpeedCap
              ? -1
              : 0;
      } else {
        const diff = wrapAngle(Math.atan2(aimY, aimX) - angle);
        wantTurn = Math.abs(diff) < 0.08 ? 0 : diff > 0 ? 1 : -1;
        if (speed > speedCap) wantThrust = -1;
        else if (speed < speedCap * 0.85 && Math.abs(diff) < 1.2) wantThrust = 1;
        else wantThrust = 0;
      }

      const nextTurnKey = wantTurn === 0 ? null : wantTurn > 0 ? 'KeyD' : 'KeyA';
      if (nextTurnKey !== turnKey) {
        if (turnKey) await setKey(turnKey, false);
        if (nextTurnKey) await setKey(nextTurnKey, true);
        turnKey = nextTurnKey;
      }
      const nextThrustKey = wantThrust === 0 ? null : wantThrust > 0 ? 'KeyW' : 'KeyS';
      if (nextThrustKey !== thrustKey) {
        if (thrustKey) await setKey(thrustKey, false);
        if (nextThrustKey) await setKey(nextThrustKey, true);
        thrustKey = nextThrustKey;
      }
      await page.waitForTimeout(100);
    }
  } finally {
    await release();
  }
}

/**
 * Waits out the evacuation countdown. It can still be cancelled server-side (leaving
 * the zone or going over the speed limit before it finishes), which does not end the
 * mission — the HUD just offers "Iniciar evacuação" again — so this polls for either
 * the party returning to the menu (done) or that button reappearing (cancelled).
 */
async function waitForEvacuation(page: Page): Promise<'done' | 'cancelled'> {
  const deadline = Date.now() + (EXTRACTION.evacuationSeconds + 8) * 1000;
  while (Date.now() < deadline) {
    if (
      await page
        .getByTestId('signed-in-as')
        .isVisible()
        .catch(() => false)
    )
      return 'done';
    if (
      await page
        .getByRole('button', { name: 'Iniciar evacuação' })
        .isVisible()
        .catch(() => false)
    ) {
      return 'cancelled';
    }
    await page.waitForTimeout(300);
  }
  return 'cancelled';
}

/**
 * Confirms the preparation, flies to the zone and extracts. A procedurally hostile
 * asteroid field (ship destroyed or flight taking too long) is accepted game variance,
 * not a defect in the extraction/settlement pipeline under test, so a failed flight
 * retries with a freshly seeded sector rather than failing the test outright.
 */
async function runMission(alfa: Page, bravo: Page, alfaNick: string, bravoNick: string) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await ensureReady(alfa);
    await ensureReady(bravo);
    await alfa.getByRole('button', { name: 'Confirmar preparação' }).click();
    await Promise.all(
      [alfa, bravo].map(async (page) => {
        await expect(page.getByTestId('game').locator('canvas')).toBeVisible();
        await expect(page.getByTestId('hud')).toContainText(alfaNick);
        await expect(page.getByTestId('hud')).toContainText(bravoNick);
      }),
    );

    let sector: Awaited<ReturnType<typeof layout>>;
    await expect
      .poll(async () => {
        sector = await layout(alfa);
        return sector?.extractionZones?.length ?? 0;
      })
      .toBe(1);
    const zone = sector?.extractionZones[0];
    if (!zone) throw new Error('zona de extração ausente');
    const asteroids = sector?.asteroids ?? [];

    await walkTo(alfa, HULL.helm.seat, HULL.helm.interactRadius - 10);
    await alfa.keyboard.press('KeyE');
    const alfaId = await sessionId(alfa);
    await expect.poll(() => world(alfa).then((w) => w?.ship.operatorId)).toBe(alfaId);

    const flightOutcome = await flyToZone(alfa, zone, asteroids);
    // Only a resolved outcome (reached and evacuated, or the mission ending on its own
    // terms) settles for real before MissionRoom#settled lets the room close — the
    // database write is already committed by the time the client is back here. A
    // voluntary leave (gave up, or cancelled mid-evacuation) is a technical abort
    // instead: the room closes the moment the last socket does, via Colyseus'
    // autoDispose, and only then does MissionRoom#onDispose fire that write, as
    // fire-and-forget. Reading mission-result right after a voluntary leave would
    // therefore race its own commit.
    let guaranteedSettled = false;
    if (flightOutcome === 'reached') {
      const extractButton = alfa.getByTestId('request-extraction');
      // The HUD polls server state on its own 200 ms cadence; give it a moment to catch
      // up with the authoritative state this test already observed as ready.
      await expect(extractButton).toBeEnabled({ timeout: 5000 });
      await extractButton.click();
      await expect(alfa.getByTestId('evacuation-countdown')).toBeVisible();
      if ((await waitForEvacuation(alfa)) === 'cancelled') {
        await Promise.all(
          [alfa, bravo].map((page) =>
            page
              .getByRole('button', { name: 'Sair da missão' })
              .click()
              .catch(() => undefined),
          ),
        );
      } else {
        guaranteedSettled = true;
      }
    } else if (flightOutcome === 'gave-up') {
      // The mission is still active server-side (its own timeout is 20 minutes) —
      // leave deliberately so this attempt ends now instead of outlasting the test.
      await Promise.all(
        [alfa, bravo].map((page) =>
          page
            .getByRole('button', { name: 'Sair da missão' })
            .click()
            .catch(() => undefined),
        ),
      );
    }
    // flightOutcome === 'disconnected' falls through with guaranteedSettled left false:
    // it could be a resolved outcome (the ship was destroyed) or a genuinely dropped
    // connection, and the two cannot be told apart from here.

    await Promise.all(
      [alfa, bravo].map((page) =>
        expect(page.getByTestId('signed-in-as')).toBeVisible({ timeout: 30_000 }),
      ),
    );

    const result = alfa.getByTestId('mission-result');
    let resultText = '';
    if (guaranteedSettled) {
      await expect(result).toBeVisible({ timeout: 10_000 });
      resultText = (await result.textContent()) ?? '';
    } else {
      // Not guaranteed to be there yet (see above): wait a little anyway, since it
      // usually already is, but treat it missing as "not extracted" rather than
      // racing the commit for an answer.
      const appeared = await result
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) resultText = (await result.textContent()) ?? '';
    }
    const extracted = resultText.includes('Extração concluída.');
    if (extracted) {
      await Promise.all(
        [alfa, bravo].map(async (page) => {
          // Only the success notice reads "A missão terminou." — a technical abort
          // reads "A missão terminou sem extração...", a different sentence entirely.
          await expect(page.getByTestId('party-notice')).toContainText('A missão terminou.');
          const page_result = page.getByTestId('mission-result');
          await expect(page_result).toContainText('Extração concluída.');
          // The stash list itself only renders once it has an item; the inventory panel
          // around it is always present, empty loadouts included.
          await expect(page.getByTestId('inventory')).not.toContainText('(reservado)');
          await expect(page.getByTestId('expedition-preparing')).toHaveCount(0);
          await page_result.getByRole('button', { name: 'Dispensar' }).click();
        }),
      );
      return;
    }
    await Promise.all(
      [alfa, bravo].map((page) =>
        page
          .getByTestId('mission-result')
          .getByRole('button', { name: 'Dispensar' })
          .click()
          .catch(() => undefined),
      ),
    );
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`a nave não extraiu em ${MAX_ATTEMPTS} tentativas (última: "${resultText}")`);
    }
  }
}

test('two successive missions extract cleanly, with no leftover reservation or duplication', async ({
  browser,
}) => {
  const alfa = await signUpInNewContext(browser, 'Extr_A', '/?debug=1');
  const bravo = await signUpInNewContext(browser, 'Extr_B');
  const code = (await alfa.page.getByTestId('party-code').textContent()) ?? '';
  await bravo.page.getByLabel('Entrar em outra party (código)').fill(code);
  await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(alfa.page.getByRole('heading', { name: /Sua party \(2\/4\)/ })).toBeVisible();
  for (const [page, name] of [
    [alfa.page, 'Piloto'],
    [bravo.page, 'Engenheiro'],
  ] as const) {
    const radio = page.getByRole('radio', { name: new RegExp(`^${name}`) });
    await radio.click();
    await expect(radio).toBeChecked();
  }

  await test.step('first mission: extracts for real, nothing stuck in the stash', async () => {
    await runMission(alfa.page, bravo.page, alfa.nick, bravo.nick);
  });

  await test.step('second mission with the same party: starts and extracts again, no duplication', async () => {
    await runMission(alfa.page, bravo.page, alfa.nick, bravo.nick);
  });
});
