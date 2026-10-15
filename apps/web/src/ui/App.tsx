import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { displayNameSchema } from '@orbit/contracts';
import { installDebugHook } from '../network/debug-hook';
import { SectorConnection, defaultServerEndpoint } from '../network/sector-connection';
import { GameView } from './GameView';
import { Hud } from './Hud';

type Screen =
  | { kind: 'menu'; error?: string }
  | { kind: 'connecting' }
  | { kind: 'playing'; connection: SectorConnection };

const ECONOMY_KEY = 'orbit.economy';

function readEconomyPreference(): boolean {
  try {
    return localStorage.getItem(ECONOMY_KEY) === '1';
  } catch {
    return false;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const [name, setName] = useState('');
  const [economy, setEconomy] = useState(readEconomyPreference);

  const toggleEconomy = useCallback(() => {
    setEconomy((current) => {
      const next = !current;
      try {
        localStorage.setItem(ECONOMY_KEY, next ? '1' : '0');
      } catch {
        // Preference is optional.
      }
      return next;
    });
  }, []);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed && !displayNameSchema.safeParse(trimmed).success) {
      setScreen({ kind: 'menu', error: 'Use de 3 a 20 letras, números ou _.' });
      return;
    }
    setScreen({ kind: 'connecting' });
    try {
      const connection = await SectorConnection.join(defaultServerEndpoint(), trimmed || undefined);
      setScreen({ kind: 'playing', connection });
    } catch {
      setScreen({ kind: 'menu', error: 'Não foi possível conectar ao servidor. Tente novamente.' });
    }
  };

  const connection = screen.kind === 'playing' ? screen.connection : null;
  useEffect(() => {
    if (!connection) return undefined;
    const removeHook = installDebugHook(connection);
    const unsubscribe = connection.onStatus((status) => {
      if (status === 'disconnected') {
        setScreen({ kind: 'menu', error: 'Conexão encerrada.' });
      }
    });
    return () => {
      unsubscribe();
      removeHook();
    };
  }, [connection]);

  if (screen.kind === 'playing') {
    const leave = () => {
      void screen.connection.leave();
      setScreen({ kind: 'menu' });
    };
    return (
      <>
        <GameView bridge={screen.connection} economy={economy} />
        <Hud
          bridge={screen.connection}
          economy={economy}
          onToggleEconomy={toggleEconomy}
          onLeave={leave}
        />
      </>
    );
  }

  return (
    <main className="menu">
      <h1>Orbit</h1>
      <p>Protótipo 0.1 — sala de desenvolvimento compartilhada.</p>
      <form onSubmit={join}>
        <label>
          Nome na tripulação (opcional)
          <input
            name="name"
            value={name}
            maxLength={20}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="inline">
          <input type="checkbox" checked={economy} onChange={toggleEconomy} /> Modo econômico (30
          FPS)
        </label>
        <button type="submit" disabled={screen.kind === 'connecting'}>
          {screen.kind === 'connecting' ? 'Conectando…' : 'Entrar na sala'}
        </button>
      </form>
      {screen.kind === 'menu' && screen.error ? (
        <p role="alert" className="error">
          {screen.error}
        </p>
      ) : null}
    </main>
  );
}
