import { type AuthContext, type Client, ServerError } from '@colyseus/core';
import { type JoinOptions, RoomPhase } from '@orbit/contracts';
import { type AccessPolicy, decideJoin } from './access-policy';
import { SectorRoom } from './sector-room';

export { ABUSE_CLOSE_CODE } from './sector-room';

export interface DevSectorAuth {
  readonly options: JoinOptions;
}

/** Development sector room of 0.1: anyone from an allowed origin walks and pilots. */
export class DevSectorRoom extends SectorRoom<DevSectorAuth> {
  #joinCount = 0;

  /** Denies everyone unless registered through `defineDevSectorRoom` with a policy. */
  static override async onAuth(
    _token: string,
    options: unknown,
    context: AuthContext,
  ): Promise<DevSectorAuth> {
    return authorizeJoin(
      { allowedOrigins: new Set(), allowMissingOrigin: false },
      options,
      context,
    );
  }

  override onJoin(client: Client<{ auth: DevSectorAuth }>): void {
    this.#joinCount++;
    this.addCrewMember(
      client.sessionId,
      client.auth?.options.name ?? `Tripulante_${this.#joinCount}`,
    );
    this.state.phase = RoomPhase.Active;
    this.syncState();
  }
}

function authorizeJoin(
  policy: AccessPolicy,
  options: unknown,
  context: AuthContext,
): DevSectorAuth {
  const decision = decideJoin(policy, context.headers.get('origin'), options);
  if (!decision.ok) throw new ServerError(403, decision.code);
  return { options: decision.options };
}

/** Binds the room class to this server's access policy. Colyseus calls `onAuth` unbound. */
export function defineDevSectorRoom(policy: AccessPolicy): typeof DevSectorRoom {
  return class ConfiguredDevSectorRoom extends DevSectorRoom {
    static override async onAuth(
      _token: string,
      options: unknown,
      context: AuthContext,
    ): Promise<DevSectorAuth> {
      return authorizeJoin(policy, options, context);
    }
  };
}
