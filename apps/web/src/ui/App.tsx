import { useCallback, useEffect, useState } from 'react';
import type { MeResponse } from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';
import { installDebugHook } from '../network/debug-hook';
import { SectorConnection, defaultServerEndpoint } from '../network/sector-connection';
import { AccessScreen } from './AccessScreen';
import { GameView } from './GameView';
import { Hud } from './Hud';
import { RecoveryCodePanel } from './RecoveryCodePanel';

type Screen =
  | { kind: 'loading' }
  | { kind: 'access'; notice?: string }
  | { kind: 'home'; me: MeResponse; suggestRecovery: boolean; error?: string }
  | { kind: 'connecting'; me: MeResponse }
  | { kind: 'playing'; me: MeResponse; connection: SectorConnection };

const ECONOMY_KEY = 'orbit.economy';

function readEconomyPreference(): boolean {
  try {
    return localStorage.getItem(ECONOMY_KEY) === '1';
  } catch {
    return false;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [economy, setEconomy] = useState(readEconomyPreference);

  useEffect(() => {
    void accountClient.me().then((result) => {
      setScreen(
        result.ok ? { kind: 'home', me: result.data, suggestRecovery: false } : { kind: 'access' },
      );
    });
  }, []);

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

  const refreshMe = useCallback(async () => {
    const result = await accountClient.me();
    setScreen((current) => {
      if (current.kind !== 'home') return current;
      return result.ok
        ? { ...current, me: result.data, suggestRecovery: false }
        : { kind: 'access', notice: describeAccountError(result.code) };
    });
  }, []);

  const signOut = async () => {
    await accountClient.logout();
    setScreen({ kind: 'access', notice: 'Você saiu da conta.' });
  };

  const join = async (me: MeResponse) => {
    setScreen({ kind: 'connecting', me });
    try {
      const connection = await SectorConnection.join(defaultServerEndpoint(), me.account.nick);
      setScreen({ kind: 'playing', me, connection });
    } catch {
      setScreen({
        kind: 'home',
        me,
        suggestRecovery: false,
        error: 'Não foi possível conectar ao servidor. Tente novamente.',
      });
    }
  };

  const connection = screen.kind === 'playing' ? screen.connection : null;
  const playingAs = screen.kind === 'playing' ? screen.me : null;
  useEffect(() => {
    if (!connection || !playingAs) return undefined;
    const me = playingAs;
    const removeHook = installDebugHook(connection);
    const unsubscribe = connection.onStatus((status) => {
      if (status === 'disconnected') {
        setScreen({ kind: 'home', me, suggestRecovery: false, error: 'Conexão encerrada.' });
      }
    });
    return () => {
      unsubscribe();
      removeHook();
    };
  }, [connection, playingAs]);

  switch (screen.kind) {
    case 'loading':
      return (
        <main className="menu">
          <h1>Orbit</h1>
          <p>Carregando…</p>
        </main>
      );
    case 'access':
      return (
        <AccessScreen
          notice={screen.notice}
          onSignedIn={(me, origin) =>
            setScreen({ kind: 'home', me, suggestRecovery: origin === 'signup' })
          }
        />
      );
    case 'playing': {
      const { me } = screen;
      const leave = () => {
        void screen.connection.leave();
        setScreen({ kind: 'home', me, suggestRecovery: false });
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
    case 'home':
    case 'connecting': {
      const { me } = screen;
      return (
        <main className="menu">
          <h1>Orbit</h1>
          <p data-testid="signed-in-as">
            Conectado como <strong>{me.account.nick}</strong>
          </p>
          <p>Protótipo 0.2 — sala de desenvolvimento compartilhada.</p>
          <label className="inline">
            <input type="checkbox" checked={economy} onChange={toggleEconomy} /> Modo econômico (30
            FPS)
          </label>
          <div className="actions">
            <button type="button" disabled={screen.kind === 'connecting'} onClick={() => join(me)}>
              {screen.kind === 'connecting' ? 'Conectando…' : 'Entrar na sala'}
            </button>
            <button type="button" className="secondary" onClick={signOut}>
              Sair da conta
            </button>
          </div>
          {screen.kind === 'home' && screen.error ? (
            <p role="alert" className="error">
              {screen.error}
            </p>
          ) : null}
          {screen.kind === 'home' ? (
            <RecoveryCodePanel
              hasCode={me.hasRecoveryCode}
              suggested={screen.suggestRecovery}
              onChange={() => void refreshMe()}
            />
          ) : null}
        </main>
      );
    }
  }
}
