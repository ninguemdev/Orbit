import * as Phaser from 'phaser';
import { CREW, SECTORS, SHIP_HULLS, SectorId, ShipHullId } from '@orbit/catalog';
import { rotate } from '@orbit/simulation';
import type { SectorBridge } from '../network/sector-connection';
import type { CrewSnapshot } from '../network/world-snapshot';
import { KeyboardControls } from './keyboard-controls';
import { PALETTE, crewColor } from './palette';

export interface SectorSceneData {
  readonly bridge: SectorBridge;
}

interface CrewView {
  readonly body: Phaser.GameObjects.Arc;
  readonly label: Phaser.GameObjects.Text;
}

const STAR_TEXTURE = 'stars';
const STAR_PARALLAX = 0.35;
const FPS_WINDOW_MS = 1000;

/**
 * Presents the authorized sector state: starfield, asteroids, the ship with its
 * interior and the crew walking inside it. It reads snapshots from the network
 * bridge and never decides positions.
 */
export class SectorScene extends Phaser.Scene {
  #bridge!: SectorBridge;
  #ship!: Phaser.GameObjects.Container;
  #helmConsole!: Phaser.GameObjects.Rectangle;
  #stars!: Phaser.GameObjects.TileSprite;
  #fpsText!: Phaser.GameObjects.Text;
  #fpsWindowStart: number | null = null;
  #framesInWindow = 0;
  #controls!: KeyboardControls;
  readonly #crew = new Map<string, CrewView>();

  constructor() {
    super('sector');
  }

  init(data: SectorSceneData): void {
    this.#bridge = data.bridge;
  }

  create(): void {
    const sector = SECTORS[SectorId.Dev];
    this.#createStarTexture();
    this.#stars = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, STAR_TEXTURE)
      .setOrigin(0)
      .setScrollFactor(0);

    const world = this.add.graphics();
    const { bounds } = sector;
    world.lineStyle(4, PALETTE.sectorEdge, 1);
    world.strokeRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
    for (const obstacle of sector.obstacles) {
      world.fillStyle(PALETTE.asteroid, 1);
      world.fillCircle(obstacle.x, obstacle.y, obstacle.radius);
      world.lineStyle(3, PALETTE.asteroidEdge, 1);
      world.strokeCircle(obstacle.x, obstacle.y, obstacle.radius);
    }

    this.#ship = this.#createShip();
    this.#fpsText = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '14px', color: '#9fb3cf' })
      .setScrollFactor(0)
      .setDepth(10);

    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.#stars.setSize(size.width, size.height);
    });
    this.#controls = new KeyboardControls(this);
    const { KeyCodes } = Phaser.Input.Keyboard;
    this.#controls.onPress(KeyCodes.E, () => this.#bridge.toggleHelm());
    this.#controls.onPress(KeyCodes.ESC, () => this.#bridge.releaseHelm());
  }

  override update(time: number): void {
    this.#sendIntent();
    const snapshot = this.#bridge.sample(performance.now());
    if (snapshot) {
      const { ship } = snapshot;
      this.#ship.setPosition(ship.x, ship.y).setRotation(ship.angle);
      this.#helmConsole.setFillStyle(ship.operatorId ? PALETTE.consoleBusy : PALETTE.console);
      this.#syncCrew(snapshot.crew, ship.x, ship.y, ship.angle);
      this.cameras.main.centerOn(ship.x, ship.y);
    }
    const camera = this.cameras.main;
    this.#stars.setTilePosition(camera.scrollX * STAR_PARALLAX, camera.scrollY * STAR_PARALLAX);
    // Counts frames actually rendered; Phaser's actualFps also counts frames skipped
    // by the economy-mode limiter.
    this.#framesInWindow++;
    this.#fpsWindowStart ??= time;
    const elapsed = time - this.#fpsWindowStart;
    if (elapsed >= FPS_WINDOW_MS) {
      this.#fpsText.setText(`${Math.round((this.#framesInWindow * 1000) / elapsed)} FPS`);
      this.#fpsWindowStart = time;
      this.#framesInWindow = 0;
    }
  }

  /**
   * At the helm, W/S are thrust and A/D turn. Walking, screen-space keys become the
   * ship's local axes (the camera does not rotate with the ship). Only intents are
   * sent; the server decides positions.
   */
  #sendIntent(): void {
    const latest = this.#bridge.latest();
    const axes = this.#controls.axes();
    if (latest?.ship.operatorId === this.#bridge.sessionId) {
      this.#bridge.setMoveIntent({ x: 0, y: 0 });
      this.#bridge.setHelmIntent({ thrust: -axes.y, turn: axes.x });
      return;
    }
    this.#bridge.setHelmIntent({ thrust: 0, turn: 0 });
    this.#bridge.setMoveIntent(rotate(axes, -(latest?.ship.angle ?? 0)));
  }

  #createStarTexture(): void {
    if (this.textures.exists(STAR_TEXTURE)) return;
    const size = 512;
    const g = this.make.graphics({}, false);
    const random = new Phaser.Math.RandomDataGenerator(['orbit-stars']);
    for (let i = 0; i < 140; i++) {
      g.fillStyle(PALETTE.star, random.realInRange(0.25, 0.9));
      g.fillRect(random.between(0, size - 2), random.between(0, size - 2), 2, 2);
    }
    g.generateTexture(STAR_TEXTURE, size, size);
    g.destroy();
  }

  #createShip(): Phaser.GameObjects.Container {
    const hull = SHIP_HULLS[ShipHullId.Scout];
    const container = this.add.container(0, 0);

    const body = this.add.graphics();
    body.fillStyle(PALETTE.hull, 1);
    body.fillPoints(
      hull.outline.map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
    );
    body.lineStyle(3, PALETTE.hullEdge, 1);
    body.strokePoints(
      hull.outline.map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
    );

    const floor = hull.interiorBounds;
    body.fillStyle(PALETTE.floor, 1);
    body.fillRect(floor.minX, floor.minY, floor.maxX - floor.minX, floor.maxY - floor.minY);
    body.fillStyle(PALETTE.wall, 1);
    for (const wall of hull.interiorWalls) {
      body.fillRect(wall.minX, wall.minY, wall.maxX - wall.minX, wall.maxY - wall.minY);
    }
    body.lineStyle(2, PALETTE.seat, 0.6);
    body.strokeCircle(hull.helm.seat.x, hull.helm.seat.y, hull.helm.interactRadius);

    // Helm console drawn separately so its color can show whether it is taken.
    const console = hull.helm.body;
    this.#helmConsole = this.add
      .rectangle(
        (console.minX + console.maxX) / 2,
        (console.minY + console.maxY) / 2,
        console.maxX - console.minX,
        console.maxY - console.minY,
        PALETTE.console,
      )
      .setOrigin(0.5);

    container.add([body, this.#helmConsole]);
    return container;
  }

  #syncCrew(
    crew: ReadonlyMap<string, CrewSnapshot>,
    shipX: number,
    shipY: number,
    angle: number,
  ): void {
    for (const [id, view] of this.#crew) {
      if (!crew.has(id)) {
        view.body.destroy();
        view.label.destroy();
        this.#crew.delete(id);
      }
    }
    for (const member of crew.values()) {
      let view = this.#crew.get(member.id);
      if (!view) {
        view = this.#createCrewView(member);
        this.#crew.set(member.id, view);
      }
      view.body.setPosition(member.x, member.y).setAlpha(member.connected ? 1 : 0.4);
      const world = rotate({ x: member.x, y: member.y }, angle);
      view.label
        .setPosition(shipX + world.x, shipY + world.y - CREW.radius - 6)
        .setText(member.atHelm ? `${member.name} (comando)` : member.name)
        .setAlpha(member.connected ? 1 : 0.5);
    }
  }

  #createCrewView(member: CrewSnapshot): CrewView {
    const isSelf = member.id === this.#bridge.sessionId;
    const body = this.add.circle(member.x, member.y, CREW.radius, crewColor(member.colorIndex));
    if (isSelf) body.setStrokeStyle(2, PALETTE.self, 1);
    this.#ship.add(body);
    const label = this.add
      .text(0, 0, member.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: isSelf ? '#ffffff' : '#c9d4e5',
      })
      .setOrigin(0.5, 1)
      .setDepth(5);
    return { body, label };
  }
}
