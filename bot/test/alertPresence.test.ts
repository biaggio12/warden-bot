import { type APIEmbed } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { AlertPresence } from '../src/alertPresence.js';
import { buildSpawnMessage, leavePresence, presenceOf, togglePresence } from '../src/messages.js';
import { spawnFixture } from './fixtures.js';

const embed = (buildSpawnMessage(spawnFixture(), { onMyWay: true }).embeds![0] as { toJSON(): APIEmbed }).toJSON();
const omw = (id: string) => (presence: ReturnType<typeof presenceOf>) => togglePresence(presence, 'onMyWay', id);

describe('AlertPresence', () => {
  it('reads the embed until the bot changed the lists, then its own state', async () => {
    const board = new AlertPresence();
    expect(board.of('m', embed)).toEqual({ onMyWay: [], onSite: [] });

    await board.change('m', embed, omw('1'), vi.fn().mockResolvedValue(undefined));

    expect(board.of('m', embed)).toEqual({ onMyWay: ['1'], onSite: [] });
  });

  it('keeps going after a failed edit, with the lists intact', async () => {
    const board = new AlertPresence();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await board.change('m', embed, omw('1'), vi.fn().mockRejectedValue(new Error('rate limited')));
    const write = vi.fn().mockResolvedValue(undefined);
    await board.change('m', embed, omw('2'), write);

    expect(presenceOf(write.mock.calls[0]![0].toJSON())).toEqual({ onMyWay: ['1', '2'], onSite: [] });
  });

  it('close waits for the edit in flight and then ignores further clicks', async () => {
    const board = new AlertPresence();
    let finish!: () => void;
    const pending = board.change('m', embed, omw('1'), () => new Promise<void>((resolve) => (finish = resolve)));
    const queued = vi.fn().mockResolvedValue(undefined);
    void board.change('m', embed, omw('2'), queued);

    const closing = board.close('m');
    finish();
    await pending;

    // The queued edit is dropped: the final message (killed / expired) wins.
    expect(await closing).toEqual({ onMyWay: ['1', '2'], onSite: [] });
    expect(queued).not.toHaveBeenCalled();
    const late = vi.fn();
    await board.change('m', embed, (p) => leavePresence(p, '1'), late);
    expect(late).not.toHaveBeenCalled();
  });

  it('knows nothing about alerts the bot never changed', async () => {
    expect(await new AlertPresence().close('m')).toBeNull();
  });
});
