import { type APIEmbed } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { AlertPresence, type PresenceStore } from '../src/alertPresence.js';
import { buildSpawnMessage, leavePresence, presenceOf, togglePresence, withPresence, type Presence } from '../src/messages.js';
import { spawnFixture } from './fixtures.js';

const embed = (buildSpawnMessage(spawnFixture(), { onMyWay: true }).embeds![0] as { toJSON(): APIEmbed }).toJSON();
const omw = (id: string) => (presence: Presence) => togglePresence(presence, 'onMyWay', id);
const alert = { spawnId: 's1', messageId: 'm' };
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(100000000000000000n + BigInt(i)));
const names = (list: string[]) => list.map((id) => `<@${id}>`).join(', ');

/** A backend that keeps what it was given, like the real one. */
function memoryStore(): PresenceStore & { saved: Map<string, Presence> } {
  const saved = new Map<string, Presence>();
  return {
    saved,
    load: vi.fn(async (_spawnId: string, messageId: string) => saved.get(messageId) ?? { onMyWay: [], onSite: [] }),
    save: vi.fn(async (_spawnId: string, messageId: string, presence: Presence) => void saved.set(messageId, presence)),
  };
}

function omwField(write: ReturnType<typeof vi.fn>, call: number) {
  return write.mock.calls[call]![0].toJSON().fields.find((f: { name: string }) => f.name.startsWith('On my way'));
}

describe('AlertPresence', () => {
  it('reads the embed until the bot changed the lists, then its own state', async () => {
    const board = new AlertPresence();
    expect(await board.of(alert, embed)).toEqual({ onMyWay: [], onSite: [] });

    await board.change(alert, embed, omw('1'), vi.fn().mockResolvedValue(undefined));

    expect(await board.of(alert, embed)).toEqual({ onMyWay: ['1'], onSite: [] });
  });

  it('keeps going after a failed edit, with the lists intact', async () => {
    const board = new AlertPresence();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await board.change(alert, embed, omw('1'), vi.fn().mockRejectedValue(new Error('rate limited')));
    const write = vi.fn().mockResolvedValue(undefined);
    await board.change(alert, embed, omw('2'), write);

    expect(presenceOf(write.mock.calls[0]![0].toJSON())).toEqual({ onMyWay: ['1', '2'], onSite: [] });
  });

  it('close waits for the edit in flight and then ignores further clicks', async () => {
    const board = new AlertPresence();
    let finish!: () => void;
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const pending = board.change(alert, embed, omw('1'), slow);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    const queued = vi.fn().mockResolvedValue(undefined);
    void board.change(alert, embed, omw('2'), queued);
    await Promise.resolve();

    const closing = board.close('m');
    finish();
    await pending;

    // The queued edit is dropped: the final message (killed / expired) wins.
    expect(await closing).toEqual({ onMyWay: ['1', '2'], onSite: [] });
    expect(queued).not.toHaveBeenCalled();
    const late = vi.fn();
    await board.change(alert, embed, (p) => leavePresence(p, '1'), late);
    expect(late).not.toHaveBeenCalled();
  });

  it('knows nothing about alerts the bot never changed', async () => {
    expect(await new AlertPresence().close('m')).toBeNull();
  });

  it('edits the alert to 10 names and +5 when 15 players are on the way, keeping the hidden ones', async () => {
    const board = new AlertPresence();
    const players = ids(15);
    const write = vi.fn().mockResolvedValue(undefined);
    for (const id of players) await board.change(alert, embed, omw(id), write);

    expect(omwField(write, 14)).toEqual({ name: 'On my way (15)', value: names(players.slice(0, 10)) + ' +5' });

    // A hidden player clicks again (leaves the list): the count drops, the names stay.
    await board.change(alert, embed, omw(players[14]!), write);
    expect(omwField(write, 15)).toEqual({ name: 'On my way (14)', value: names(players.slice(0, 10)) + ' +4' });
    // A named player leaves: the 11th moves up into the names.
    await board.change(alert, embed, omw(players[0]!), write);
    expect(omwField(write, 16)!.value).toBe(names(players.slice(1, 11)) + ' +3');
  });

  it('saves the full lists with every edit and gets them back after a restart', async () => {
    const store = memoryStore();
    const players = ids(15);
    const before = new AlertPresence(store);
    for (const id of players) await before.change(alert, embed, omw(id), vi.fn().mockResolvedValue(undefined));
    expect(store.saved.get('m')).toEqual({ onMyWay: players, onSite: [] });
    expect(store.save).toHaveBeenCalledWith('s1', 'm', expect.anything());

    // The restarted bot sees only 10 names in the alert, the store has all 15.
    const shown = withPresence(embed, { onMyWay: players, onSite: [] }).toJSON();
    const after = new AlertPresence(store);
    const write = vi.fn().mockResolvedValue(undefined);
    await after.change(alert, shown, omw('999'), write);

    expect(omwField(write, 0)).toEqual({ name: 'On my way (16)', value: names(players.slice(0, 10)) + ' +6' });
    expect(store.saved.get('m')!.onMyWay).toEqual([...players, '999']);
  });

  it('closing an alert from before a restart returns the stored lists', async () => {
    const store = memoryStore();
    store.saved.set('m', { onMyWay: ids(15), onSite: ['7'] });

    expect(await new AlertPresence(store).close('m', 's1')).toEqual({ onMyWay: ids(15), onSite: ['7'] });
    expect(await new AlertPresence(store).close('unknown', 's1')).toBeNull();
  });

  it('falls back to the names in the alert when the store cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store: PresenceStore = { load: vi.fn().mockRejectedValue(new Error('down')), save: vi.fn().mockRejectedValue(new Error('down')) };
    const shown = withPresence(embed, { onMyWay: ['1', '2'], onSite: [] }).toJSON();
    const write = vi.fn().mockResolvedValue(undefined);

    await new AlertPresence(store).change(alert, shown, omw('3'), write);

    expect(presenceOf(write.mock.calls[0]![0].toJSON())).toEqual({ onMyWay: ['1', '2', '3'], onSite: [] });
  });

  it('keeps the lists of several alerts apart when players click them all at once', async () => {
    const store = memoryStore();
    const board = new AlertPresence(store);
    const a = { spawnId: 'hydra', messageId: 'a' };
    const b = { spawnId: 'dragon', messageId: 'b' };
    const writeA = vi.fn().mockResolvedValue(undefined);
    const writeB = vi.fn().mockResolvedValue(undefined);

    // 30 players on each, interleaved, without waiting; player 0 goes to both Wardens.
    await Promise.all(ids(30).flatMap((id) => [board.change(a, embed, omw(id), writeA), board.change(b, embed, omw(id), writeB)]));

    expect(await board.of(a, embed)).toEqual({ onMyWay: ids(30), onSite: [] });
    expect(await board.of(b, embed)).toEqual({ onMyWay: ids(30), onSite: [] });
    expect(store.saved.get('a')!.onMyWay).toEqual(ids(30));
    expect(store.saved.get('b')!.onMyWay).toEqual(ids(30));
    expect(store.save).toHaveBeenCalledWith('hydra', 'a', expect.anything());
    expect(store.save).not.toHaveBeenCalledWith('hydra', 'b', expect.anything());
    // Rushes become a few edits per alert, not 30.
    expect(writeA.mock.calls.length).toBeLessThan(5);
    expect(omwField(writeA, writeA.mock.calls.length - 1)).toEqual({ name: 'On my way (30)', value: names(ids(10)) + ' +20' });
  });
});
