import { type FormEvent, useState } from 'react';
import { CLASS_NAMES, isClassId } from '@orbit/catalog';
import { PARTY_MAX_MEMBERS } from '@orbit/contracts';
import type { PartyControls } from './use-party';

export interface PartyPanelProps {
  readonly party: PartyControls;
  readonly myAccountId: string;
}

/** Members, invites and the codes to join another party. */
export function PartyPanel({ party, myAccountId }: PartyPanelProps) {
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  const { view } = party;
  const isLeader = view?.leaderId === myAccountId;

  const className = (classId: string) =>
    isClassId(classId) ? CLASS_NAMES[classId] : 'classe não escolhida';

  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    await party.joinByCode(code);
    setCode('');
  };

  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (!nick.trim()) return;
    party.invite(nick);
    setNick('');
  };

  return (
    <section className="panel" aria-label="Party" data-testid="party">
      <h2>Sua party {view ? `(${view.members.length}/${PARTY_MAX_MEMBERS})` : ''}</h2>
      {view ? (
        <>
          <p>
            Código da party: <strong data-testid="party-code">{view.inviteCode}</strong>
          </p>
          <ul className="party-members" data-testid="party-members">
            {view.members.map((member) => (
              <li key={member.accountId}>
                {member.nick} ({className(member.classId)})
                {member.accountId === view.leaderId ? ' — líder' : ''}
                {member.accountId === myAccountId ? ' (você)' : ''}
                {member.connected ? '' : ' — desconectado'}
                {member.ready ? ' — pronto' : ''}
                {isLeader && member.accountId !== myAccountId ? (
                  <span className="member-actions">
                    <button type="button" onClick={() => party.promote(member.accountId)}>
                      Passar liderança
                    </button>
                    <button type="button" onClick={() => party.kick(member.accountId)}>
                      Remover
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {view.members.length > 1 ? (
            <button
              type="button"
              className="secondary"
              disabled={party.busy}
              onClick={() => void party.leaveParty()}
            >
              Sair da party
            </button>
          ) : null}
        </>
      ) : party.movedElsewhere ? (
        <button type="button" disabled={party.busy} onClick={() => void party.reclaim()}>
          Usar a party nesta janela
        </button>
      ) : (
        <p>Conectando à party…</p>
      )}

      {isLeader ? (
        <form onSubmit={invite} aria-label="Convidar por nick" className="inline-form">
          <label>
            Convidar jogador online (nick)
            <input
              name="invite-nick"
              value={nick}
              maxLength={20}
              autoComplete="off"
              onChange={(event) => setNick(event.target.value)}
            />
          </label>
          <button type="submit">Convidar</button>
        </form>
      ) : null}

      <form onSubmit={join} aria-label="Entrar em outra party" className="inline-form">
        <label>
          Entrar em outra party (código)
          <input
            name="party-code"
            value={code}
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button type="submit" disabled={party.busy}>
          Entrar
        </button>
      </form>

      {party.invites.length > 0 ? (
        <ul className="party-invites" aria-label="Convites recebidos">
          {party.invites.map((invite) => (
            <li key={invite.inviteId}>
              {invite.fromNick} convidou você ({invite.memberCount}/{PARTY_MAX_MEMBERS})
              <button
                type="button"
                disabled={party.busy}
                onClick={() => void party.acceptInvite(invite.inviteId)}
              >
                Aceitar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => party.declineInvite(invite.inviteId)}
              >
                Recusar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {party.notice ? (
        <p role="status" className="notice" data-testid="party-notice">
          {party.notice}
        </p>
      ) : null}
    </section>
  );
}
