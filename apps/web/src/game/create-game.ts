import * as Phaser from 'phaser';
import type { SectorBridge } from '../network/sector-connection';
import { PALETTE } from './palette';
import { SectorScene, type SectorSceneData } from './sector-scene';

export interface GameOptions {
  /** Economy mode caps rendering at 30 FPS. Server tick and rules are unaffected. */
  readonly economy: boolean;
}

export function createGame(
  parent: HTMLElement,
  bridge: SectorBridge,
  options: GameOptions,
): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: PALETTE.space,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    fps: options.economy ? { target: 30, limit: 30 } : { target: 60 },
    audio: { noAudio: true },
    banner: false,
  });
  const data: SectorSceneData = { bridge };
  game.scene.add('sector', SectorScene, true, data);
  return game;
}
