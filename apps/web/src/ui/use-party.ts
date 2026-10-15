import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PARTY_KICKED_CLOSE_CODE,
  PARTY_MOVED_CLOSE_CODE,
  type PartyInviteNotice,
  type PartyTicketRequest,
} from '@orbit/contracts';
import { type ClientErrorCode, describeAccountError } from '../network/account-client';
import { PartyConnection, type PartyView } from '../network/party-connection';

export interface PendingInvite extends PartyInviteNotice {
  readonly receivedAt: number;
}

export interface PartyControls {
  readonly view: PartyView | null;
  readonly invites: readonly PendingInvite[];
  readonly notice: string | null;
  readonly busy: boolean;
  /** The account entered a party from another window; this one stays out until reclaimed. */
  readonly movedElsewhere: boolean;
  joinByCode(code: string): Promise<void>;
  acceptInvite(inviteId: string): Promise<void>;
  declineInvite(inviteId: string): void;
  invite(nick: string): void;
  kick(accountId: string): void;
  promote(accountId: string): void;
  selectClass(classId: string): void;
  /** Leader only; the server checks that a member holds the license. */
  selectShip(shipId: string): void;
  leaveParty(): Promise<void>;
  reclaim(): Promise<void>;
}

const REFUSAL_TEXT: Record<string, string> = {
  player_offline: 'Esse jogador não está online.',
  already_member: 'Esse jogador já está na party.',
  party_full: 'A party já está completa.',
  not_leader: 'Só o líder pode fazer isso.',
  not_member: 'Esse jogador não está mais na party.',
  invalid_payload: 'Pedido inválido.',
  unknown_class: 'Classe desconhecida.',
  ship_unavailable: 'Nenhum membro da party tem licença dessa nave.',
  class_not_saved: 'Não foi possível salvar a classe. Tente de novo.',
};

type OpenOutcome = { ok: true } | { ok: false; code: ClientErrorCode | 'join_failed' | 'stale' };

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

/**
 * Keeps the signed-in player in exactly one party: a solo party by default,
 * replaced when they join another one, and recreated after leaving, being removed
 * or losing the connection. A second window of the same account takes over the
 * party; the first one then waits instead of fighting for it.
 */
export function useParty(signedIn: boolean): PartyControls {
  const [view, setView] = useState<PartyView | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [movedElsewhere, setMovedElsewhere] = useState(false);
  const current = useRef<PartyConnection | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Connection being replaced by a join in progress. The server removes us from it
   * while admitting us to the new party, and that close can arrive before the join
   * resolves: it must not be treated as a lost party.
   */
  const replacing = useRef<PartyConnection | null>(null);
  const ensureSoloRef = useRef<(attempt?: number) => void>(() => undefined);

  const open = useCallback(async (request: PartyTicketRequest): Promise<OpenOutcome> => {
    const myGeneration = ++generation.current;
    replacing.current = current.current;
    // Set once this connection exists; a failed later attempt keeps this one current.
    let self: PartyConnection | null = null;
    const isCurrent = () => self !== null && current.current === self;
    const result = await PartyConnection.open(request, {
      onChange: (next) => {
        if (isCurrent() || generation.current === myGeneration) setView(next);
      },
      onInvite: (invite) =>
        setInvites((list) => [
          ...list.filter((item) => item.inviteId !== invite.inviteId),
          { ...invite, receivedAt: Date.now() },
        ]),
      onRefused: (refusal) => setNotice(REFUSAL_TEXT[refusal.code] ?? 'Ação recusada.'),
      onClosed: (code) => {
        if (!isCurrent() || self === replacing.current) return; // Replaced by a newer party.
        current.current = null;
        setView(null);
        if (code === PARTY_MOVED_CLOSE_CODE) {
          setMovedElsewhere(true);
          setNotice('Sua conta entrou em uma party em outra janela.');
          return;
        }
        setNotice(
          code === PARTY_KICKED_CLOSE_CODE
            ? 'Você foi removido da party pelo líder.'
            : 'A conexão com a party foi encerrada. Você voltou para uma party só sua.',
        );
        ensureSoloRef.current();
      },
    });
    replacing.current = null;
    if (!result.ok) {
      // The party we stayed in may have closed while we tried to leave it.
      if (current.current?.closed && generation.current === myGeneration) {
        current.current = null;
        setView(null);
        ensureSoloRef.current();
      }
      return result;
    }
    if (generation.current !== myGeneration || !active.current) {
      void result.party.leave();
      return { ok: false, code: 'stale' };
    }
    const previous = current.current;
    self = result.party;
    current.current = result.party;
    setMovedElsewhere(false);
    // The server already moved us out of the previous party; close our side quietly.
    if (previous) void previous.leave();
    return { ok: true };
  }, []);

  /** Opens a solo party, retrying with backoff while the player has none. */
  const ensureSolo = useCallback(
    (attempt = 0) => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      void open({ intent: 'create' }).then((outcome) => {
        if (outcome.ok || outcome.code === 'stale' || !active.current || current.current) return;
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
        setNotice('Não foi possível conectar à party. Tentando de novo…');
        retryTimer.current = setTimeout(() => ensureSolo(attempt + 1), delay);
      });
    },
    [open],
  );
  ensureSoloRef.current = ensureSolo;

  useEffect(() => {
    if (!signedIn) return undefined;
    active.current = true;
    ensureSolo();
    return () => {
      active.current = false;
      generation.current++;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      void current.current?.leave();
      current.current = null;
      setView(null);
      setInvites([]);
      setMovedElsewhere(false);
    };
  }, [signedIn, ensureSolo]);

  // Invites expire on the server after `expiresInSeconds`; drop them here too.
  useEffect(() => {
    if (invites.length === 0) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      setInvites((list) =>
        list.filter((invite) => now < invite.receivedAt + invite.expiresInSeconds * 1000),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [invites.length]);

  const run = async (request: PartyTicketRequest): Promise<OpenOutcome> => {
    setBusy(true);
    setNotice(null);
    const outcome = await open(request);
    if (!outcome.ok && outcome.code !== 'stale') {
      setNotice(
        outcome.code === 'join_failed'
          ? 'Não foi possível entrar na party. Tente de novo.'
          : describeAccountError(outcome.code),
      );
    }
    setBusy(false);
    return outcome;
  };

  return {
    view,
    invites,
    notice,
    busy,
    movedElsewhere,
    joinByCode: async (code) => {
      await run({ intent: 'join', inviteCode: code.trim() });
    },
    acceptInvite: async (inviteId) => {
      const outcome = await run({ intent: 'accept', inviteId });
      // A full party keeps the invite valid; anything else ends it.
      if (outcome.ok || outcome.code !== 'party_full') {
        setInvites((list) => list.filter((item) => item.inviteId !== inviteId));
      }
    },
    declineInvite: (inviteId) =>
      setInvites((list) => list.filter((item) => item.inviteId !== inviteId)),
    invite: (nick) => {
      setNotice(null);
      current.current?.invite(nick.trim());
    },
    kick: (accountId) => current.current?.kick(accountId),
    promote: (accountId) => current.current?.promote(accountId),
    selectClass: (classId) => current.current?.selectClass(classId),
    selectShip: (shipId) => current.current?.selectShip(shipId),
    leaveParty: async () => {
      await run({ intent: 'create' });
    },
    reclaim: async () => {
      await run({ intent: 'create' });
    },
  };
}
