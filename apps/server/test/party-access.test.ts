import { describe, expect, it } from 'vitest';
import { PartyAccess } from '../src/modules/party/party-access';
import { PartyDirectory } from '../src/modules/party/party-directory';
import { RoomTicketStore } from '../src/modules/party/room-tickets';

describe('party access limits', () => {
  const holder = (accountId: string) => ({ accountId, nick: accountId, classId: '', ships: [] });

  it('limits invite code attempts per address, independently of the account', () => {
    const access = new PartyAccess({
      tickets: new RoomTicketStore(),
      directory: new PartyDirectory(),
      codeGuessesPerAddress: 3,
    });
    const guess = (accountId: string, address: string) =>
      access.issue({ intent: 'join', inviteCode: 'ABCDEF' }, holder(accountId), address);

    for (let i = 0; i < 3; i++) {
      expect(guess(`account-${i}`, '10.0.0.1')).toEqual({ ok: false, code: 'invalid_invite_code' });
    }
    expect(guess('account-9', '10.0.0.1')).toEqual({ ok: false, code: 'rate_limited' });
    expect(guess('account-9', '10.0.0.2')).toEqual({ ok: false, code: 'invalid_invite_code' });
  });
});
