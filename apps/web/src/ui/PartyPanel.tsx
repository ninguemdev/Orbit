import { type FormEvent, useEffect, useState } from 'react';
import { CLASS_DESCRIPTIONS, CLASS_NAMES, CLASS_ORDER, isClassId } from '@orbit/catalog';
import { PARTY_MAX_MEMBERS } from '@orbit/contracts';
import type { PartyControls } from './use-party';

interface PartyPanelProps {
  readonly party: PartyControls;
  readonly myAccountId: string;
}

export function PartyPanel({ party, myAccountId }: PartyPanelProps) {
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  const { view } = party;
  const isLeader = view?.leaderId === myAccountId;
  const myClass = view?.members.find((member) => member.accountId === myAccountId)?.classId ?? '';
  // Shows the choice immediately; the synchronized state confirms it a moment later.
  const [pendingClass, setPendingClass] = useState<string | null>(null);
  useEffect(() => {
    if (pendingClass === null) return undefined;
    if (pendingClass === myClass) {
      setPendingClass(null);
      return undefined;
    }
    // Not confirmed (refused or lost): fall back to the synchronized state.
    const timer = setTimeout(() => setPendingClass(null), 3000);
    return () => clearTimeout(timer);
  }, [myClass, pendingClass]);
  const shownClass = pendingClass ?? myClass;
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
    <section className="party" aria-label="Party" data-testid="party">
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

      {view ? (
        <fieldset className="class-picker">
          <legend>Sua classe na próxima missão</legend>
          <p className="hint">
            Classes repetidas são permitidas. Nesta versão a escolha só identifica a função na
            party; os efeitos entram no jogo nas versões indicadas.
          </p>
          {CLASS_ORDER.map((classId) => (
            <label key={classId} className="class-option">
              <input
                type="radio"
                name="class"
                value={classId}
                checked={shownClass === classId}
                onChange={() => {
                  setPendingClass(classId);
                  party.selectClass(classId);
                }}
              />
              <strong>{CLASS_NAMES[classId]}</strong>
              <span className="hint">
                {CLASS_DESCRIPTIONS[classId].role} Efeitos a partir da{' '}
                {CLASS_DESCRIPTIONS[classId].availableIn}.
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

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
