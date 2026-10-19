import { useEffect, useState } from 'react';
import type { SectorBridge } from '../network/sector-connection';

const HUD_REFRESH_MS = 200;
const NOTICE_VISIBLE_MS = 3000;

const NOTICE_TEXT: Record<string, string> = {
  helm_occupied: 'O comando já está ocupado.',
  helm_out_of_range: 'Aproxime-se do console de comando (círculo amarelo).',
  not_helm_operator: 'Você não está no comando.',
  invalid_payload: 'Ação recusada pelo servidor.',
  match_not_active: 'A missão começa quando toda a tripulação entrar.',
  not_at_hatch: 'Vá até a eclusa de carga, na popa da nave.',
  container_out_of_reach: 'Encoste a nave no contêiner para pegar o que ele guarda.',
  invalid_transfer: 'Esse item não pode ir para lá.',
  item_not_found: 'O item já foi pego.',
  invalid_quantity: 'Quantidade inválida.',
  inventory_full: 'Sem espaço para tudo isso.',
  not_item_owner: 'Só o dono move o próprio equipamento.',
};

interface HudState {
  readonly status: string;
  readonly ping: number | null;
  readonly crew: readonly {
    id: string;
    name: string;
    atHelm: boolean;
    connected: boolean;
    self: boolean;
  }[];
  readonly operator: string | null;
  readonly notice: string | null;
}

function readHud(bridge: SectorBridge): HudState {
  const snapshot = bridge.latest();
  const crew = snapshot
    ? [...snapshot.crew.values()].map((member) => ({
        id: member.id,
        name: member.name,
        atHelm: member.atHelm,
        connected: member.connected,
        self: member.id === bridge.sessionId,
      }))
    : [];
  const operatorId = snapshot?.ship.operatorId;
  const operator = operatorId ? (snapshot?.crew.get(operatorId)?.name ?? null) : null;
  const notice = bridge.lastNotice;
  const noticeText =
    notice && performance.now() - notice.at < NOTICE_VISIBLE_MS
      ? (NOTICE_TEXT[notice.code] ?? 'Ação recusada.')
      : null;
  return { status: bridge.status, ping: bridge.pingMs, crew, operator, notice: noticeText };
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  disconnected: 'Desconectado',
};

interface HudProps {
  readonly bridge: SectorBridge;
  readonly economy: boolean;
  readonly onToggleEconomy: () => void;
  readonly onLeave: () => void;
  readonly leaveLabel?: string;
}

/** Overlay refreshed at 5 Hz from the latest authorized state, not every frame. */
export function Hud({ bridge, economy, onToggleEconomy, onLeave, leaveLabel = 'Sair' }: HudProps) {
  const [hud, setHud] = useState(() => readHud(bridge));

  useEffect(() => {
    const timer = setInterval(() => setHud(readHud(bridge)), HUD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [bridge]);

  return (
    <aside className="hud" data-testid="hud">
      <p data-testid="connection-status">
        {STATUS_LABEL[hud.status] ?? hud.status}
        {hud.ping !== null ? ` · ${hud.ping} ms` : ''}
      </p>
      <p data-testid="helm-operator">Comando: {hud.operator ?? 'livre'}</p>
      <ul className="crew-list">
        {hud.crew.map((member) => (
          <li key={member.id}>
            {member.name}
            {member.self ? ' (você)' : ''}
            {member.atHelm ? ' — no comando' : ''}
            {member.connected ? '' : ' — reconectando'}
          </li>
        ))}
      </ul>
      {hud.notice ? (
        <p role="status" className="notice">
          {hud.notice}
        </p>
      ) : null}
      <p className="controls">
        WASD mover · E assumir/sair do comando · No comando: W/S acelerar/frear, A/D girar · Esc
        sair do comando · Eclusa (popa): porão e contêineres
      </p>
      <div className="hud-actions">
        <label>
          <input type="checkbox" checked={economy} onChange={onToggleEconomy} /> Modo econômico (30
          FPS)
        </label>
        <button type="button" onClick={onLeave}>
          {leaveLabel}
        </button>
      </div>
    </aside>
  );
}
