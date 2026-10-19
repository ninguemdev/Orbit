import * as Phaser from 'phaser';
import { CREW, SHIP_HULLS, ShipHullId, isShipHullId } from '@orbit/catalog';
import { rotate } from '@orbit/simulation';
import type { SectorBridge } from '../network/sector-connection';
import type { CrewSnapshot, SectorLayout } from '../network/world-snapshot';
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
const MINIMAP_SIZE = 180;
const MINIMAP_MARGIN = 12;
const LABEL_STYLE = { fontFamily: 'system-ui, sans-serif', fontSize: '14px' } as const;

interface Minimap {
  readonly map: Phaser.GameObjects.Graphics;
  readonly ship: Phaser.GameObjects.Triangle;
  /** World position to a point inside the minimap, in its own pixels. */
  readonly at: (x: number, y: number) => [number, number];
}

/**
 * Presents the authorized sector state: starfield, asteroids, the ship with its
 * interior and the crew walking inside it. It reads snapshots from the network
 * bridge and never decides positions.
 */
export class SectorScene extends Phaser.Scene {
  #bridge!: SectorBridge;
  /** Created from the first state, which names the ship. */
  #ship: Phaser.GameObjects.Container | null = null;
  #helmConsole!: Phaser.GameObjects.Rectangle;
  #minimap: Minimap | null = null;
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
    this.#createStarTexture();
    this.#stars = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, STAR_TEXTURE)
      .setOrigin(0)
      .setScrollFactor(0);

    this.#fpsText = this.add
      .text(12, 12, '', { fontFamily: 'monospace', fontSize: '14px', color: '#9fb3cf' })
      .setScrollFactor(0)
      .setDepth(10);

    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.#stars.setSize(size.width, size.height);
      this.#placeMinimap(size.height);
    });
    this.#controls = new KeyboardControls(this);
    const { KeyCodes } = Phaser.Input.Keyboard;
    this.#controls.onPress(KeyCodes.E, () => this.#bridge.toggleHelm());
    this.#controls.onPress(KeyCodes.ESC, () => this.#bridge.releaseHelm());
  }

  override update(time: number): void {
    this.#sendIntent();
    if (!this.#minimap) {
      const layout = this.#bridge.layout();
      if (layout) this.#createSector(layout);
    }
    const snapshot = this.#bridge.sample(performance.now());
    if (snapshot) {
      const { ship } = snapshot;
      this.#ship ??= this.#createShip(isShipHullId(ship.hullId) ? ship.hullId : ShipHullId.Scout);
      this.#ship.setPosition(ship.x, ship.y).setRotation(ship.angle);
      this.#helmConsole.setFillStyle(ship.operatorId ? PALETTE.consoleBusy : PALETTE.console);
      this.#syncCrew(this.#ship, snapshot.crew, ship.x, ship.y, ship.angle);
      this.cameras.main.centerOn(ship.x, ship.y);
      this.#minimap?.ship.setPosition(...this.#toMinimap(ship.x, ship.y)).setRotation(ship.angle);
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

  /** Draws the static geometry once: edge, asteroids, containers and extraction zones. */
  #createSector(layout: SectorLayout): void {
    const { bounds } = layout;
    const world = this.add.graphics().setDepth(0);
    for (const zone of layout.extractionZones) {
      world.fillStyle(PALETTE.extraction, 0.12);
      world.fillCircle(zone.x, zone.y, zone.radius);
      world.lineStyle(4, PALETTE.extractionEdge, 0.8);
      world.strokeCircle(zone.x, zone.y, zone.radius);
      this.#worldLabel(zone.x, zone.y, 'Extração', '#8de8b0');
    }
    world.lineStyle(4, PALETTE.sectorEdge, 1);
    world.strokeRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
    for (const asteroid of layout.asteroids) {
      world.fillStyle(PALETTE.asteroid, 1);
      world.fillCircle(asteroid.x, asteroid.y, asteroid.radius);
      world.lineStyle(3, PALETTE.asteroidEdge, 1);
      world.strokeCircle(asteroid.x, asteroid.y, asteroid.radius);
    }
    for (const container of layout.containers) {
      // The outline is the solid circle the ship collides with; the square marks a crate.
      const side = container.radius * Math.SQRT2;
      world.fillStyle(PALETTE.container, 1);
      world.fillCircle(container.x, container.y, container.radius);
      world.lineStyle(3, PALETTE.containerEdge, 1);
      world.strokeCircle(container.x, container.y, container.radius);
      world.strokeRect(container.x - side / 2, container.y - side / 2, side, side);
      this.#worldLabel(container.x, container.y - container.radius - 8, 'Contêiner', '#ffd08a');
    }
    this.#createMinimap(layout);
  }

  #worldLabel(x: number, y: number, text: string, color: string): void {
    this.add
      .text(x, y, text, { ...LABEL_STYLE, color })
      .setOrigin(0.5, 1)
      .setDepth(0);
  }

  /** Whole sector in a corner: drawn once; only the ship marker moves. */
  #createMinimap(layout: SectorLayout): void {
    const { bounds } = layout;
    const scale = MINIMAP_SIZE / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const at = (x: number, y: number): [number, number] => [
      (x - bounds.minX) * scale,
      (y - bounds.minY) * scale,
    ];
    const map = this.add.graphics().setScrollFactor(0).setDepth(10);
    map.fillStyle(PALETTE.minimap, 0.85);
    map.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    map.lineStyle(1, PALETTE.sectorEdge, 1);
    map.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    for (const zone of layout.extractionZones) {
      map.fillStyle(PALETTE.extraction, 0.5);
      map.fillCircle(...at(zone.x, zone.y), Math.max(3, zone.radius * scale));
    }
    map.fillStyle(PALETTE.asteroidEdge, 0.8);
    for (const asteroid of layout.asteroids) {
      map.fillCircle(...at(asteroid.x, asteroid.y), Math.max(1, asteroid.radius * scale));
    }
    map.fillStyle(PALETTE.containerEdge, 1);
    for (const container of layout.containers) {
      const [x, y] = at(container.x, container.y);
      map.fillRect(x - 2, y - 2, 5, 5);
    }
    const ship = this.add
      // Nose to the right; the default origin centers it on the ship.
      .triangle(0, 0, 10, 4, 0, 0, 0, 8, PALETTE.self)
      .setScrollFactor(0)
      .setDepth(11);
    this.#minimap = { map, ship, at };
    this.#placeMinimap(this.scale.height);
  }

  #placeMinimap(screenHeight: number): void {
    this.#minimap?.map.setPosition(MINIMAP_MARGIN, screenHeight - MINIMAP_MARGIN - MINIMAP_SIZE);
  }

  #toMinimap(x: number, y: number): [number, number] {
    const minimap = this.#minimap;
    if (!minimap) return [0, 0];
    const [mapX, mapY] = minimap.at(x, y);
    return [minimap.map.x + mapX, minimap.map.y + mapY];
  }

  #createShip(hullId: ShipHullId): Phaser.GameObjects.Container {
    const hull = SHIP_HULLS[hullId];
    const container = this.add.container(0, 0).setDepth(1);

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
    // Cargo hatch: where the crew reaches the hold and containers alongside.
    const hatch = hull.cargoHatch;
    body.lineStyle(2, PALETTE.hatch, 0.7);
    body.strokeCircle(hatch.position.x, hatch.position.y, hatch.interactRadius);

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
    ship: Phaser.GameObjects.Container,
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
        view = this.#createCrewView(ship, member);
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

  #createCrewView(ship: Phaser.GameObjects.Container, member: CrewSnapshot): CrewView {
    const isSelf = member.id === this.#bridge.sessionId;
    const body = this.add.circle(member.x, member.y, CREW.radius, crewColor(member.colorIndex));
    if (isSelf) body.setStrokeStyle(2, PALETTE.self, 1);
    ship.add(body);
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
