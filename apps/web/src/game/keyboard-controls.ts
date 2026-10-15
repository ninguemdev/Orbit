import * as Phaser from 'phaser';
import { clampLength } from '@orbit/simulation';

type Key = Phaser.Input.Keyboard.Key;

/**
 * Reads WASD/arrow keys as screen-space axes. Keys are released when the window
 * loses focus or is hidden, so no stale key keeps the player moving.
 */
export class KeyboardControls {
  readonly #keyboard: Phaser.Input.Keyboard.KeyboardPlugin;
  readonly #up: Key[];
  readonly #down: Key[];
  readonly #left: Key[];
  readonly #right: Key[];

  constructor(scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Teclado indisponível');
    this.#keyboard = keyboard;
    const { KeyCodes } = Phaser.Input.Keyboard;
    const add = (...codes: number[]) => codes.map((code) => keyboard.addKey(code));
    this.#up = add(KeyCodes.W, KeyCodes.UP);
    this.#down = add(KeyCodes.S, KeyCodes.DOWN);
    this.#left = add(KeyCodes.A, KeyCodes.LEFT);
    this.#right = add(KeyCodes.D, KeyCodes.RIGHT);
    const release = () => keyboard.resetKeys();
    scene.game.events.on(Phaser.Core.Events.BLUR, release);
    scene.game.events.on(Phaser.Core.Events.HIDDEN, release);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.game.events.off(Phaser.Core.Events.BLUR, release);
      scene.game.events.off(Phaser.Core.Events.HIDDEN, release);
    });
  }

  /** Screen-space direction (+y is down), length ≤ 1. */
  axes(): { x: number; y: number } {
    const held = (keys: Key[]) => (keys.some((key) => key.isDown) ? 1 : 0);
    return clampLength(
      { x: held(this.#right) - held(this.#left), y: held(this.#down) - held(this.#up) },
      1,
    );
  }

  /** Registers a one-shot key press handler. */
  onPress(code: number, handler: () => void): void {
    this.#keyboard.addKey(code).on('down', handler);
  }
}
