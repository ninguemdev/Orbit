import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import {
  AccountRoute,
  PARTY_ROOM_NAME,
  PartyClientMessage,
  type PartyRefusal,
  PartyRoute,
  PartyServerMessage,
  type PartyStateView,
  type PartyTicketResponse,
} from '@orbit/contracts';
import { DEFAULT_IDENTITY_POLICY } from '../src/modules/identity/identity-service';
import { ALLOWED_ORIGIN, type ApiServer, call, startApiServer } from './api-harness';

/** A class save the test finishes by hand, to observe what the party shows meanwhile. */
interface PendingSave {
  readonly classId: string;
  finish(ok: boolean): void;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Tempo esgotado aguardando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('party class choice is shown only once saved', () => {
  let api: ApiServer;
  let pending: PendingSave[] = [];
  let rooms: Room<unknown, PartyStateView>[] = [];
  let counter = 0;

  beforeAll(async () => {
    api = await startApiServer(
      { ...DEFAULT_IDENTITY_POLICY, loginAttemptsPerAddress: 1000, signUpsPerAddress: 1000 },
      {
        classPreferences: {
          save: (_accountId, classId) =>
            new Promise<void>((resolve, reject) => {
              pending.push({
                classId,
                finish: (ok) => (ok ? resolve() : reject(new Error('banco indisponível'))),
              });
            }),
        },
      },
    );
  });

  afterEach(async () => {
    await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
    rooms = [];
    pending = [];
  });

  afterAll(async () => {
    await api?.close();
  });

  async function soloParty() {
    const signUp = await call(api.baseUrl, AccountRoute.Accounts, {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { nick: `Classe_${++counter}`, password: 'senha de classe longa' },
    });
    const id = (signUp.body as { account: { id: string } }).account.id;
    const issued = (
      await call(api.baseUrl, PartyRoute.Tickets, {
        method: 'POST',
        origin: ALLOWED_ORIGIN,
        token: signUp.token ?? '',
        body: { intent: 'create' },
      })
    ).body as PartyTicketResponse;
    const client = new Client(api.baseUrl);
    client.auth.token = issued.ticket;
    const room = await client.create<PartyStateView>(PARTY_ROOM_NAME);
    rooms.push(room);
    await waitFor(() => room.state.members?.size === 1, 'party criada');
    const classOf = () => {
      let classId = '';
      room.state.members.forEach((member, memberId) => {
        if (memberId === id) classId = member.classId;
      });
      return classId;
    };
    return { room, classOf };
  }

  it('shows a class after the account saved it, applying saves in order', async () => {
    const { room, classOf } = await soloParty();
    room.send(PartyClientMessage.SelectClass, { classId: 'class.pilot' });
    room.send(PartyClientMessage.SelectClass, { classId: 'class.medic' });
    await waitFor(() => pending.length === 1, 'primeiro salvamento');
    // Nothing is shown while the save is pending, and the second waits for the first.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(classOf()).toBe('');
    expect(pending.map((save) => save.classId)).toEqual(['class.pilot']);

    pending[0]?.finish(true);
    await waitFor(() => classOf() === 'class.pilot', 'piloto exibido');
    await waitFor(() => pending.length === 2, 'segundo salvamento');
    pending[1]?.finish(true);
    await waitFor(() => classOf() === 'class.medic', 'médico exibido');
  });

  it('keeps the previous class and tells the player when the save fails', async () => {
    const { room, classOf } = await soloParty();
    const refused: PartyRefusal[] = [];
    room.onMessage(PartyServerMessage.Refused, (refusal: PartyRefusal) => refused.push(refusal));
    room.send(PartyClientMessage.SelectClass, { classId: 'class.engineer' });
    await waitFor(() => pending.length === 1, 'salvamento');
    pending[0]?.finish(true);
    await waitFor(() => classOf() === 'class.engineer', 'engenheiro exibido');

    room.send(PartyClientMessage.SelectClass, { classId: 'class.officer' });
    await waitFor(() => pending.length === 2, 'salvamento que falha');
    pending[1]?.finish(false);
    await waitFor(() => refused.length === 1, 'recusa');
    expect(refused[0]).toMatchObject({
      action: PartyClientMessage.SelectClass,
      code: 'class_not_saved',
    });
    expect(classOf()).toBe('class.engineer');
  });
});
