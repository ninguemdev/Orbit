import { CLASS_DESCRIPTIONS, CLASS_NAMES, CLASS_ORDER } from '@orbit/catalog';
import type { PartyPanelProps } from './PartyPanel';
import { shipName } from './catalog-names';

/** Ship, class and readiness of the party's next mission. */
export function MissionSetupPanel({ party, myAccountId }: PartyPanelProps) {
  const { view } = party;
  if (!view) {
    return (
      <section className="panel" aria-label="Próxima missão" data-testid="mission-setup">
        <h2>Próxima missão</h2>
        <p className="hint">
          Nave, classe e prontidão aparecem com a party conectada nesta janela.
        </p>
      </section>
    );
  }
  const isLeader = view.leaderId === myAccountId;
  const me = view.members.find((member) => member.accountId === myAccountId);
  const myClass = me?.classId ?? '';
  // Before the first state sync there is no revision to name.
  const synced = view.revision >= 1;
  const allReady = view.members.every((member) => member.ready && member.connected);

  // Union of the members' licenses, with who brings each ship (arrival order).
  const ships = new Map<string, string[]>();
  for (const member of view.members) {
    for (const shipId of member.ships)
      ships.set(shipId, [...(ships.get(shipId) ?? []), member.nick]);
  }

  return (
    <section className="panel" aria-label="Próxima missão" data-testid="mission-setup">
      <h2>Próxima missão</h2>
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
      <fieldset className="class-picker">
        <legend>Sua classe na próxima missão</legend>
        <p className="hint">
          Classes repetidas são permitidas e a escolha fica salva na sua conta. Nesta versão ela só
          identifica a função na party; os efeitos entram no jogo nas versões indicadas.
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
      <fieldset className="class-picker" data-testid="party-readiness">
        <legend>Prontidão</legend>
        <p className="hint">
          Qualquer mudança na party, na classe, na nave ou no loadout desfaz a prontidão de todos.
          Ao confirmar, o servidor reserva os itens dos loadouts para a missão.
        </p>
        {view.confirmedRevision === view.revision ? (
          <p className="notice" data-testid="party-confirmed">
            Preparação confirmada pelo líder.
          </p>
        ) : null}
        {view.expedition ? <PreparationStatus secondsLeft={view.expedition.secondsLeft} /> : null}
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
    </section>
  );
}

/**
 * Reserved items waiting for the match. The match room arrives in the next step of
 * 0.3; until then the server cancels the preparation when its countdown ends.
 */
function PreparationStatus({ secondsLeft }: { secondsLeft: number }) {
  return (
    <p className="notice" data-testid="expedition-preparing">
      Itens reservados para a missão. A partida com a party ainda não abre nesta versão: a
      preparação expira em {secondsLeft} s e os itens voltam ao stash.
    </p>
  );
}
