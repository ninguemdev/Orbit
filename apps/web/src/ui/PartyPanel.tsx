import { type FormEvent, useState } from 'react';
import { CLASS_DESCRIPTIONS, CLASS_NAMES, CLASS_ORDER, isClassId } from '@orbit/catalog';
import { PARTY_MAX_MEMBERS } from '@orbit/contracts';
import { shipName } from './catalog-names';
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
  const me = view?.members.find((member) => member.accountId === myAccountId);
  const myClass = me?.classId ?? '';
  // Before the first state sync there is no revision to name.
  const synced = (view?.revision ?? 0) >= 1;
  const allReady =
    view !== null && view.members.every((member) => member.ready && member.connected);

  // Union of the members' licenses, with who brings each ship (arrival order).
  const ships = new Map<string, string[]>();
  for (const member of view?.members ?? []) {
    for (const shipId of member.ships)
      ships.set(shipId, [...(ships.get(shipId) ?? []), member.nick]);
  }

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

      {view ? (
        <fieldset className="class-picker" data-testid="party-ships">
          <legend>Nave da missão</legend>
          <p className="hint">
            A party pode usar qualquer nave liberada por um dos membros.{' '}
            {isLeader ? 'Você escolhe a nave.' : 'O líder escolhe a nave.'}
          </p>
          {view.selectedShipId ? null : (
            <p className="notice" data-testid="ship-missing">
              Nenhuma nave escolhida.
            </p>
          )}
          {[...ships.entries()].map(([shipId, owners]) => (
            <label key={shipId} className="class-option">
              <input
                type="radio"
                name="ship"
                value={shipId}
                checked={view.selectedShipId === shipId}
                disabled={!isLeader}
                onChange={() => party.selectShip(shipId)}
              />
              <strong>{shipName(shipId)}</strong>
              <span className="hint">Liberada por: {owners.join(', ')}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {view ? (
        <fieldset className="class-picker">
          <legend>Sua classe na próxima missão</legend>
          <p className="hint">
            Classes repetidas são permitidas e a escolha fica salva na sua conta. Nesta versão ela
            só identifica a função na party; os efeitos entram no jogo nas versões indicadas.
          </p>
          {CLASS_ORDER.map((classId) => (
            <label key={classId} className="class-option">
              <input
                type="radio"
                name="class"
                value={classId}
                checked={myClass === classId}
                onChange={() => party.selectClass(classId)}
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

      {view ? (
        <fieldset className="class-picker" data-testid="party-readiness">
          <legend>Prontidão</legend>
          <p className="hint">
            Qualquer mudança na party, na classe, na nave ou no loadout desfaz a prontidão de todos.
            A missão e a reserva dos itens começam na 0.3.
          </p>
          {view.confirmedRevision === view.revision ? (
            <p className="notice" data-testid="party-confirmed">
              Preparação confirmada pelo líder.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => party.setReady(view.revision, !me?.ready)}
            disabled={!me || !synced}
          >
            {me?.ready ? 'Não estou pronto' : 'Estou pronto'}
          </button>{' '}
          {isLeader ? (
            <button
              type="button"
              disabled={!synced || !allReady || !view.selectedShipId}
              onClick={() => party.confirm(view.revision)}
            >
              Confirmar preparação
            </button>
          ) : null}
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
