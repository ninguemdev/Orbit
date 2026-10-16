import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MISSION_CANCELLED_CLOSE_CODE,
  MISSION_ENDED_CLOSE_CODE,
  type MeResponse,
} from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';
import { installDebugHook } from '../network/debug-hook';
import { SectorConnection, defaultServerEndpoint } from '../network/sector-connection';
import { AccessScreen } from './AccessScreen';
import { GameView } from './GameView';
import { Hud } from './Hud';
import { PreparationPanels } from './InventoryPanel';
import { MissionSetupPanel } from './MissionSetupPanel';
import { PartyPanel } from './PartyPanel';
import { RecoveryCodePanel } from './RecoveryCodePanel';
import { useParty } from './use-party';

type Screen =
  | { kind: 'loading'; error?: string }
  | { kind: 'access'; notice?: string }
  | { kind: 'home'; me: MeResponse; suggestRecovery: boolean; error?: string }
  | { kind: 'connecting'; me: MeResponse }
  /** In a sector: the development room of 0.1, or the mission room of an expedition. */
  | { kind: 'playing'; me: MeResponse; connection: SectorConnection; mission: boolean };

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
  const signedIn =
    screen.kind === 'home' || screen.kind === 'connecting' || screen.kind === 'playing';
  // The party stays connected while the player is in the development room.
  const party = useParty(signedIn);

  // Only a missing/expired session leads to the access screen; transient failures
  // (network, overload) keep the player where they are and offer a retry.
  const loadSession = useCallback(async () => {
    setScreen({ kind: 'loading' });
    const result = await accountClient.me();
    if (result.ok) setScreen({ kind: 'home', me: result.data, suggestRecovery: false });
    else if (result.code === 'unauthenticated') setScreen({ kind: 'access' });
    else setScreen({ kind: 'loading', error: describeAccountError(result.code) });
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  /** Incremented on sign-out so a join still in flight does not enter the room. */
  const joinAttempt = useRef(0);

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
      if (result.ok) return { ...current, me: result.data, suggestRecovery: false };
      if (result.code === 'unauthenticated') {
        return { kind: 'access', notice: describeAccountError(result.code) };
      }
      // Keep the screen (and any recovery code on display); the status refreshes later.
      return { ...current, suggestRecovery: false };
    });
  }, []);

  const signOut = async (me: MeResponse) => {
    joinAttempt.current++;
    const result = await accountClient.logout();
    // An already-dead session counts as signed out; any other failure means the
    // cookie may still be valid, so the player must know they are still signed in.
    if (result.ok || result.code === 'unauthenticated') {
      setScreen({ kind: 'access', notice: 'Você saiu da conta.' });
    } else {
      setScreen({
        kind: 'home',
        me,
        suggestRecovery: false,
        error: `Não foi possível sair da conta. ${describeAccountError(result.code)}`,
      });
    }
  };

  const join = async (me: MeResponse) => {
    const attempt = ++joinAttempt.current;
    setScreen({ kind: 'connecting', me });
    try {
      const connection = await SectorConnection.join(defaultServerEndpoint(), me.account.nick);
      if (attempt !== joinAttempt.current) {
        void connection.leave();
        return;
      }
      setScreen({ kind: 'playing', me, connection, mission: false });
    } catch {
      if (attempt !== joinAttempt.current) return;
      setScreen({
        kind: 'home',
        me,
        suggestRecovery: false,
        error: 'Não foi possível conectar ao servidor. Tente novamente.',
      });
    }
  };

  /** Enters the mission room of the party's expedition with a fresh ticket. */
  const enterMission = useCallback(async (me: MeResponse) => {
    const attempt = ++joinAttempt.current;
    setScreen({ kind: 'connecting', me });
    const fail = (error: string) => {
      if (attempt === joinAttempt.current) {
        setScreen({ kind: 'home', me, suggestRecovery: false, error });
      }
    };
    const issued = await accountClient.missionTicket();
    if (!issued.ok) return fail(describeAccountError(issued.code));
    try {
      const connection = await SectorConnection.joinMission(defaultServerEndpoint(), issued.data);
      if (attempt !== joinAttempt.current) {
        void connection.leave();
        return;
      }
      setScreen({ kind: 'playing', me, connection, mission: true });
    } catch {
      fail('Não foi possível entrar na missão. Tente de novo antes de o prazo acabar.');
    }
  }, []);

  // The confirmation reserved the loadouts: everyone loads into the match on their own.
  // Each expedition is entered automatically once; afterwards the panel offers a button.
  const autoEntered = useRef<string | null>(null);
  const expeditionId = party.view?.expedition?.id ?? null;
  const homeAs = screen.kind === 'home' ? screen.me : null;
  useEffect(() => {
    if (!homeAs || !expeditionId || autoEntered.current === expeditionId) return;
    autoEntered.current = expeditionId;
    void enterMission(homeAs);
  }, [homeAs, expeditionId, enterMission]);

  const connection = screen.kind === 'playing' ? screen.connection : null;
  const playingAs = screen.kind === 'playing' ? screen.me : null;
  useEffect(() => {
    if (!connection || !playingAs) return undefined;
    const me = playingAs;
    const removeHook = installDebugHook(connection);
    const unsubscribe = connection.onStatus((status) => {
      if (status !== 'disconnected') return;
      // The end of a mission is explained by the party notice; anything else is a loss.
      const explained =
        connection.closeCode === MISSION_CANCELLED_CLOSE_CODE ||
        connection.closeCode === MISSION_ENDED_CLOSE_CODE;
      setScreen({
        kind: 'home',
        me,
        suggestRecovery: false,
        ...(explained ? {} : { error: 'Conexão encerrada.' }),
      });
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
          {screen.error ? (
            <>
              <p role="alert" className="error">
                {screen.error}
              </p>
              <button type="button" onClick={() => void loadSession()}>
                Tentar de novo
              </button>
            </>
          ) : (
            <p>Carregando…</p>
          )}
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
            leaveLabel={screen.mission ? 'Sair da missão' : 'Sair'}
          />
        </>
      );
    }
    case 'home':
    case 'connecting': {
      const { me } = screen;
      return (
        <main className="home">
          <header className="home-bar">
            <h1>Orbit</h1>
            <p data-testid="signed-in-as">
              Conectado como <strong>{me.account.nick}</strong>
            </p>
            <label className="inline">
              <input type="checkbox" checked={economy} onChange={toggleEconomy} /> Modo econômico
              (30 FPS)
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={screen.kind === 'connecting'}
                onClick={() => join(me)}
              >
                {screen.kind === 'connecting' ? 'Conectando…' : 'Entrar na sala'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={screen.kind === 'connecting'}
                onClick={() => void signOut(me)}
              >
                Sair da conta
              </button>
            </div>
          </header>
          <p className="hint">
            Prepare a próxima missão: forme a party, escolha classe, loadout e nave e confirme a
            prontidão. A confirmação reserva os itens e leva a party para a missão. &quot;Entrar na
            sala&quot; abre a sala de testes da 0.1, compartilhada por todos e sem a sua party.
          </p>
          {screen.kind === 'home' && screen.error ? (
            <p role="alert" className="error">
              {screen.error}
            </p>
          ) : null}
          <div className="home-columns">
            <div className="home-column">
              <PartyPanel party={party} myAccountId={me.account.id} />
              {screen.kind === 'home' ? (
                <RecoveryCodePanel
                  hasCode={me.hasRecoveryCode}
                  suggested={screen.suggestRecovery}
                  onChange={() => void refreshMe()}
                />
              ) : null}
            </div>
            <div className="home-column">
              <MissionSetupPanel
                party={party}
                myAccountId={me.account.id}
                entering={screen.kind === 'connecting'}
                onEnterMission={() => void enterMission(me)}
              />
            </div>
            <div className="home-column">
              <PreparationPanels
                classId={
                  party.view?.members.find((member) => member.accountId === me.account.id)
                    ?.classId ??
                  me.profile.classId ??
                  ''
                }
                expeditionId={party.view?.expedition?.id ?? ''}
              />
            </div>
          </div>
        </main>
      );
    }
  }
}
