import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PARTY_KICKED_CLOSE_CODE,
  type PartyInviteNotice,
  type PartyTicketRequest,
} from '@orbit/contracts';
import { describeAccountError } from '../network/account-client';
import { PartyConnection, type PartyView } from '../network/party-connection';

export interface PendingInvite extends PartyInviteNotice {
  readonly receivedAt: number;
}

export interface PartyControls {
  readonly view: PartyView | null;
  readonly invites: readonly PendingInvite[];
  readonly notice: string | null;
  readonly busy: boolean;
  joinByCode(code: string): Promise<void>;
  acceptInvite(inviteId: string): Promise<void>;
  declineInvite(inviteId: string): void;
  invite(nick: string): void;
  kick(accountId: string): void;
  promote(accountId: string): void;
  leaveParty(): Promise<void>;
}

const REFUSAL_TEXT: Record<string, string> = {
  player_offline: 'Esse jogador não está online.',
  already_member: 'Esse jogador já está na party.',
  party_full: 'A party já está completa.',
  not_leader: 'Só o líder pode fazer isso.',
  not_member: 'Esse jogador não está mais na party.',
  invalid_payload: 'Pedido inválido.',
};

/**
 * Keeps the signed-in player in exactly one party: a solo party by default,
 * replaced when they join another one, and recreated after leaving or being removed.
 */
export function useParty(signedIn: boolean): PartyControls {
  const [view, setView] = useState<PartyView | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<PartyConnection | null>(null);
  const generation = useRef(0);
  /**
   * Connection being replaced by a join in progress. The server removes us from it
   * while admitting us to the new party, and that close can arrive before the join
   * resolves: it must not be treated as a lost party.
   */
  const replacing = useRef<PartyConnection | null>(null);

  const open = useCallback(async (request: PartyTicketRequest): Promise<boolean> => {
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
        setNotice(
          code === PARTY_KICKED_CLOSE_CODE
            ? 'Você foi removido da party pelo líder.'
            : 'A conexão com a party foi encerrada. Você voltou para uma party só sua.',
        );
        void open({ intent: 'create' });
      },
    });
    replacing.current = null;
    if (!result.ok) {
      setNotice(
        result.code === 'join_failed'
          ? 'Não foi possível entrar na party. Tente de novo.'
          : describeAccountError(result.code),
      );
      // The party we stayed in may have closed while we tried to leave it.
      if (current.current?.closed && generation.current === myGeneration) {
        current.current = null;
        setView(null);
        void open({ intent: 'create' });
      }
      return false;
    }
    if (generation.current !== myGeneration) {
      void result.party.leave();
      return false;
    }
    const previous = current.current;
    self = result.party;
    current.current = result.party;
    // The server already moved us out of the previous party; close our side quietly.
    if (previous) void previous.leave();
    return true;
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    void open({ intent: 'create' });
    return () => {
      generation.current++;
      void current.current?.leave();
      current.current = null;
      setView(null);
      setInvites([]);
    };
  }, [signedIn, open]);

  const run = async (request: PartyTicketRequest) => {
    setBusy(true);
    setNotice(null);
    await open(request);
    setBusy(false);
  };

  return {
    view,
    invites,
    notice,
    busy,
    joinByCode: (code) => run({ intent: 'join', inviteCode: code.trim() }),
    acceptInvite: async (inviteId) => {
      setInvites((list) => list.filter((item) => item.inviteId !== inviteId));
      await run({ intent: 'accept', inviteId });
    },
    declineInvite: (inviteId) =>
      setInvites((list) => list.filter((item) => item.inviteId !== inviteId)),
    invite: (nick) => {
      setNotice(null);
      current.current?.invite(nick.trim());
    },
    kick: (accountId) => current.current?.kick(accountId),
    promote: (accountId) => current.current?.promote(accountId),
    leaveParty: () => run({ intent: 'create' }),
  };
}
