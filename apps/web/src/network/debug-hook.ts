import type { SectorConnection } from './sector-connection';

export interface OrbitDebugView {
  readonly sessionId: string;
  readonly roomId: string;
  readonly status: string;
  /** Last server state received, as plain data. Read-only: nothing here sends intents. */
  latest(): unknown;
  /** Static sector geometry received on entry. */
  layout(): unknown;
  /** Ship pose per server tick for the recently received states. */
  shipHistory(): unknown;
}

declare global {
  interface Window {
    __orbit?: OrbitDebugView;
  }
}

/** Exposes read-only connection data for automated browser checks (`?debug=1` or dev server). */
export function installDebugHook(connection: SectorConnection): () => void {
  const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
  if (!enabled) return () => undefined;
  window.__orbit = {
    sessionId: connection.sessionId,
    roomId: connection.roomId,
    get status() {
      return connection.status;
    },
    layout() {
      return connection.layout();
    },
    shipHistory() {
      return connection.recent().map((snapshot) => ({ tick: snapshot.tick, ship: snapshot.ship }));
    },
    latest() {
      const snapshot = connection.latest();
      if (!snapshot) return null;
      return { ...snapshot, crew: Object.fromEntries(snapshot.crew) };
    },
  };
  return () => {
    delete window.__orbit;
  };
}
