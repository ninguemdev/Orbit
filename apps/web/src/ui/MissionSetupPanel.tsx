import { CLASS_DESCRIPTIONS, CLASS_NAMES, CLASS_ORDER } from '@orbit/catalog';
import type { PartyPanelProps } from './PartyPanel';
import type { PartyView } from '../network/party-connection';
import { shipName } from './catalog-names';

interface MissionSetupPanelProps extends PartyPanelProps {
  /** A mission entry is in progress. */
  readonly entering: boolean;
  readonly onEnterMission: () => void;
}

/** Ship, class and readiness of the party's next mission. */
export function MissionSetupPanel({
  party,
  myAccountId,
  entering,
  onEnterMission,
}: MissionSetupPanelProps) {
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
  // While the party's match runs, nothing else can be confirmed.
  const running = view.expedition?.state === 'ACTIVE';
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
        <MissionStatus
          expedition={view.expedition}
          myAccountId={myAccountId}
          entering={entering}
          onEnterMission={onEnterMission}
        />
        {running ? null : (
          <>
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
          </>
        )}
      </fieldset>
    </section>
  );
}

interface MissionStatusProps {
  readonly expedition: PartyView['expedition'];
  readonly myAccountId: string;
  readonly entering: boolean;
  readonly onEnterMission: () => void;
}

/**
 * The reserved expedition: loading into the match (everyone must enter before the
 * countdown ends) or the match already running. Its members can always enter again;
 * who joined the party later only sees that the others are away.
 */
function MissionStatus({ expedition, myAccountId, entering, onEnterMission }: MissionStatusProps) {
  if (!expedition) return null;
  if (!expedition.memberIds.includes(myAccountId)) {
    return (
      <p className="notice" data-testid="expedition-preparing">
        A party está numa missão que começou antes de você entrar. A próxima missão pode ser
        preparada quando ela terminar.
      </p>
    );
  }
  return (
    <div className="mission-status">
      <p className="notice" data-testid="expedition-preparing">
        {expedition.state === 'ACTIVE'
          ? 'Missão em andamento. Volte para a sua tripulação.'
          : `Itens reservados. Entrando na missão: se alguém não entrar em ${expedition.secondsLeft} s, a preparação é cancelada e os itens voltam ao stash.`}
      </p>
      <button type="button" disabled={entering} onClick={onEnterMission}>
        {entering ? 'Entrando…' : 'Entrar na missão'}
      </button>
    </div>
  );
}
