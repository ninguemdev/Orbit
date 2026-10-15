import { useEffect, useRef } from 'react';
import type { SectorBridge } from '../network/sector-connection';

interface GameViewProps {
  readonly bridge: SectorBridge;
  readonly economy: boolean;
}

/**
 * Mounts the Phaser game, loaded on demand so the menu does not download the engine.
 * React does not re-render per frame; Phaser owns the canvas.
 */
export function GameView({ bridge, economy }: GameViewProps) {
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    void import('../game/create-game').then(({ createGame }) => {
      if (cancelled || !parent.current) return;
      const game = createGame(parent.current, bridge, { economy });
      destroy = () => game.destroy(true);
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [bridge, economy]);

  return <div ref={parent} className="game" data-testid="game" />;
}
