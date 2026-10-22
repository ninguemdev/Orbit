import { type Page, expect, test } from '@playwright/test';
import { CREW, EXTRACTION, SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { closeOpenContexts, signUpInNewContext } from './support/accounts';
import { type Cockpit, fly, planFlight } from './support/autopilot';

test.afterEach(closeOpenContexts);
// The flight is a closed loop over thousands of Playwright calls, and tracing records each
// one with DOM snapshots that wait on the page's busy main thread: measured locally, every
// state read and key event then takes about three times as long (~140 ms instead of ~45;
// CI's own flight logs put it near 400 ms) and a key pulse lands hundreds of milliseconds
// late — the very latency that kept the old flight loop from ever controlling the ship on
// CI. The flight prints its own log instead, and a failure still leaves a screenshot.
test.use({ trace: 'off', screenshot: 'only-on-failure' });

const HULL = SHIP_HULLS[ShipHullId.Scout];
const SPEED_LIMIT = HULL.handling.maxSpeed * EXTRACTION.maxSpeedFraction;
// The CI job this runs in (.github/workflows/ci.yml, "Multiplayer com dois navegadores")
// is capped at 38 real minutes, and setup plus the other 11 specs already use about 4 of
// those — a budget the external kill enforces regardless of what Playwright's own
// test.setTimeout says, and without a clean error. So the two missions below, worst case
// (every attempt of both exhausting its own flight deadline), must fit well inside the
// remainder. The autopilot (support/autopilot.ts) flies only as fast as the page's
// measured response time still lets it brake in time, so a slower machine makes a flight
// longer rather than riskier: this favours giving each attempt real room over having
// many of them.
const FLIGHT_DEADLINE_MS = 240_000;
// A hostile seed is accepted game variance (see runMission), not a bug, so a failed
// flight retries with a fresh sector; bounded so a run of bad luck still terminates (and
// stays inside the CI job budget above: see FLIGHT_DEADLINE_MS).
const MAX_ATTEMPTS = 3;
// Slack per attempt beyond the flight itself: ready-up, confirm, walk to the helm, the
// evacuation wait, and the menu transition. This is a realistic budget for those, not
// walkTo's own absolute worst case (it could in principle run far longer) — a run that
// pathological is already its own, rarer problem, worth a bare Playwright timeout to flag
// as unusual rather than a budget sized only to accommodate it.
const PER_ATTEMPT_OVERHEAD_MS = 45_000;
test.setTimeout(2 * MAX_ATTEMPTS * (FLIGHT_DEADLINE_MS + PER_ATTEMPT_OVERHEAD_MS));

interface ShipState {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly operatorId: string;
  readonly hullPoints: number;
}
interface MissionWorld {
  readonly tick: number;
  readonly ship: ShipState;
  readonly crew: Record<string, { readonly x: number; readonly y: number }>;
}
interface Zone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}
interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const world = (page: Page) =>
  page.evaluate(() => window.__orbit?.latest() as MissionWorld | null | undefined);
const layout = (page: Page) =>
  page.evaluate(
    () =>
      window.__orbit?.layout() as
        | {
            bounds: Bounds;
            extractionZones: Zone[];
            asteroids: readonly Zone[];
            containers: readonly Zone[];
          }
        | null
        | undefined,
  );
const sessionId = (page: Page) => page.evaluate(() => window.__orbit?.sessionId ?? '');

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
  // Phaser applies key events once per frame, so a press and its release that both land
  // between two frames of a slow page move nothing at all: the shortest pulse grows until
  // the page answers it, instead of retrying the same vanishing tap until out of attempts.
  let shortestMs = 30;
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
    const holdMs = Math.min(500, Math.max(shortestMs, wantedMs - extraMs));
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    for (const key of keys) await page.keyboard.up(key);
    await untilStill(page, id);
    const after = (await world(page))?.crew[id];
    if (!after) throw new Error('estado ausente');
    const moved = Math.hypot(after.x - self.x, after.y - self.y);
    const movedMs = (moved / CREW.walkSpeed) * 1000;
    if (movedMs > holdMs) extraMs = movedMs - holdMs;
    if (moved < 0.5) shortestMs = Math.min(500, holdMs * 2);
  }
  throw new Error('não chegou ao destino');
}

/**
 * Flies the ship to the extraction zone by keyboard (support/autopilot.ts), around every
 * solid the server collides it with. Returns 'reached' once well inside the zone and
 * nearly stopped, 'disconnected' if the mission state disappears first (ship destroyed,
 * server-side mission timeout — the real one is 20 minutes, not this function's budget),
 * or 'gave-up' if this function's own patience runs out while the mission is still
 * active, or no route was found at all (should not happen: the server already guarantees
 * one for a ship this size or larger before offering the mission) — the caller must then
 * actively leave, since the server will otherwise keep the mission running.
 */
async function flyToZone(
  page: Page,
  zone: Zone,
  solids: readonly Zone[],
  bounds: Bounds,
): Promise<'reached' | 'disconnected' | 'gave-up'> {
  const fitRadius = zone.radius - HULL.handling.radius;
  const start = (await world(page))?.ship;
  if (!start) return 'disconnected';
  const pilot = planFlight({
    handling: HULL.handling,
    bounds,
    solids,
    start,
    goal: zone,
    // Generation keeps every solid far beyond the zone's own edge: anywhere this close to
    // its center is open space for the whole hull.
    goalRadius: fitRadius * 0.6,
  });
  if (!pilot) return 'gave-up';
  const route = pilot.waypoints.map(({ x, y }) => `(${x.toFixed(0)},${y.toFixed(0)})`);
  console.log(`[flight] route ${route.join(' ')}`);

  // Printed straight to the CI log (no artifact download needed): the flight profile of a
  // failure, not a guess, is what any next fix should start from.
  let hullPoints = HULL.maxHull;
  let loggedHull = hullPoints;
  let loggedAt = 0;
  const cockpit: Cockpit = {
    read: async () => {
      const state = await world(page);
      if (!state) return null;
      hullPoints = state.ship.hullPoints;
      return { tick: state.tick, ...state.ship };
    },
    key: (code, down) => (down ? page.keyboard.down(code) : page.keyboard.up(code)),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
    now: () => Date.now(),
  };
  return fly(cockpit, pilot, {
    deadlineMs: Date.now() + FLIGHT_DEADLINE_MS,
    // Well inside and nearly stopped, not merely under the limit at this instant: with the
    // keys released, residual speed v still carries the ship v / linearDamping further (4v
    // for this hull), and leaving the zone or going over the limit during the 10s
    // evacuation countdown cancels it — see the cancellation handling in runMission. Half
    // the fit radius plus that drift stays well inside the zone.
    arrived: (ship) =>
      Math.hypot(zone.x - ship.x, zone.y - ship.y) <= fitRadius * 0.5 &&
      Math.hypot(ship.vx, ship.vy) <= SPEED_LIMIT / 4,
    onDecision: (ship, maneuver) => {
      const now = Date.now();
      if (hullPoints === loggedHull && !pilot.overriding && now - loggedAt < 2000) return;
      loggedHull = hullPoints;
      loggedAt = now;
      console.log(
        `[flight] t=${now} hull=${hullPoints.toFixed(1)} ` +
          `pos=(${ship.x.toFixed(0)},${ship.y.toFixed(0)}) ${pilot.status} ` +
          `thrust=${maneuver.thrust}/${maneuver.thrustMs.toFixed(0)}ms ` +
          `turn=${maneuver.turn}/${maneuver.turnMs.toFixed(0)}ms`,
      );
    },
  });
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
      .poll(
        async () => {
          sector = await layout(alfa);
          return sector?.extractionZones?.length ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    const zone = sector?.extractionZones[0];
    if (!zone) throw new Error('zona de extração ausente');
    // The layout lists containers apart, but they are just as solid as asteroids.
    const solids = [...(sector?.asteroids ?? []), ...(sector?.containers ?? [])];
    const bounds = sector?.bounds;
    if (!bounds) throw new Error('limites do setor ausentes');

    await walkTo(alfa, HULL.helm.seat, HULL.helm.interactRadius - 10);
    await alfa.keyboard.press('KeyE');
    const alfaId = await sessionId(alfa);
    await expect.poll(() => world(alfa).then((w) => w?.ship.operatorId)).toBe(alfaId);

    const flightOutcome = await flyToZone(alfa, zone, solids, bounds);
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
