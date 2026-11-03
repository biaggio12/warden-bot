import { describe, expect, it } from 'vitest';
import { InvalidEventError, parseEvent } from '../src/events.js';

describe('parseEvent', () => {
  it('parses warden.spawned as produced by the backend serializer', () => {
    const event = parseEvent(JSON.stringify({
      event: 'warden.spawned',
      occurred_at: '2026-10-29T12:00:00Z',
      data: {
        spawn_id: 'abc',
        monster: { id: 142, name: 'Dragon Warden', category: 'Dragons' },
        server_name: 'Monza',
        city: 'Venore',
        location_description: 'Dragon Lair',
        additional_info: 'Przy bramce',
        reported_by_discord_user_id: null,
        created_at: '2026-10-29T12:00:00Z',
        expires_at: '2026-10-29T12:07:00Z',
      },
    }));

    expect(event.event).toBe('warden.spawned');
    expect(event.event === 'warden.spawned' && event.data.monster.name).toBe('Dragon Warden');
    expect(event.event === 'warden.spawned' && event.data.city).toBe('Venore');
    expect(event.event === 'warden.spawned' && event.data.additional_info).toBe('Przy bramce');
  });

  it('treats city and additional info as optional (older events)', () => {
    const event = parseEvent(JSON.stringify({
      event: 'warden.spawned',
      data: {
        spawn_id: 'abc',
        monster: { id: 142, name: 'Dragon Warden', category: 'Dragons' },
        server_name: 'Monza',
        location_description: 'Venore',
        created_at: '2026-10-29T12:00:00Z',
        expires_at: '2026-10-29T12:07:00Z',
      },
    }));

    expect(event).toMatchObject({ data: { city: null, additional_info: null, monster: { image_url: null } } });
  });

  it('parses warden.expired', () => {
    const event = parseEvent(JSON.stringify({
      event: 'warden.expired',
      data: { spawn_id: 'abc', monster_id: 142, server_name: 'Monza', expires_at: '2026-10-29T12:07:00Z' },
    }));

    expect(event).toMatchObject({ event: 'warden.expired', data: { spawn_id: 'abc', monster_id: 142 } });
  });

  it('parses warden.killed', () => {
    const event = parseEvent(JSON.stringify({
      event: 'warden.killed',
      data: { spawn_id: 'abc', monster_id: 142, server_name: 'Monza', killed_by_discord_user_id: null, killed_by_name: 'lukasz' },
    }));

    expect(event).toEqual({
      event: 'warden.killed',
      occurred_at: expect.any(String),
      data: { spawn_id: 'abc', monster_id: 142, server_name: 'Monza', killed_by_discord_user_id: null, killed_by_name: 'lukasz' },
    });
  });

  it('parses warden.deleted', () => {
    const event = parseEvent(JSON.stringify({ event: 'warden.deleted', occurred_at: '2026-11-02T10:00:00Z', data: { spawn_id: 'abc', server_name: 'Monza' } }));

    expect(event).toEqual({ event: 'warden.deleted', occurred_at: '2026-11-02T10:00:00Z', data: { spawn_id: 'abc', server_name: 'Monza' } });
  });

  it.each([
    ['not json', '{'],
    ['unknown event', JSON.stringify({ event: 'other', data: {} })],
    ['missing field', JSON.stringify({ event: 'warden.expired', data: { spawn_id: 'abc' } })],
  ])('rejects %s', (_, raw) => {
    expect(() => parseEvent(raw)).toThrow(InvalidEventError);
  });
});
