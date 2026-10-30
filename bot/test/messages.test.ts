import { ButtonStyle, ComponentType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  allButtonsDisabled,
  bestiaryUrlOf,
  buildSpawnMessage,
  disabledButtonRows,
  killButtonId,
  killSelectId,
  mentionChunks,
  presenceButtonId,
  presenceListOf,
  presenceOf,
  togglePresence,
  parseKillCustomId,
  parsePostedAlert,
  withPresence,
  unixSeconds,
} from '../src/messages.js';
import { postedAlert, spawnFixture } from './fixtures.js';

function render(options: Parameters<typeof buildSpawnMessage>[1] = {}, overrides: Parameters<typeof spawnFixture>[0] = {}) {
  const message = buildSpawnMessage(spawnFixture({ location_description: 'Lair *-2*', ...overrides }), options);
  const embed = (message.embeds![0] as { toJSON(): any }).toJSON();
  const row = (message.components![0] as { toJSON(): any }).toJSON();
  return { embed, button: row.components[0] };
}

describe('buildSpawnMessage', () => {
  it.each([
    [{ reported_by_discord_user_id: '42', reported_by_characters: ['Sir Tester', 'Lady_Tester'] }, '<@42> (Sir Tester, Lady\\_Tester)'],
    [{ reported_by_characters: [], reported_by_name: 'lukasz' }, 'lukasz'],
    [{ reported_by_characters: ['Sir Tester'] }, 'Sir Tester'],
    [{ reported_by_characters: [] }, 'a player'],
  ])('shows who reported it (%o)', (overrides, expected) => {
    const { embed } = render({}, overrides);
    expect(embed.fields.find((f: { name: string }) => f.name === 'Reported by')).toEqual({ name: 'Reported by', value: expected, inline: true });
  });

  it('contains monster, location, relative countdown and an active [Killed] button', () => {
    const { embed, button } = render();
    const fields = JSON.stringify(embed.fields);

    expect(embed.title).toContain('Dragon Warden');
    expect(embed.fields.map((f: { name: string }) => f.name)).toEqual(['Class', 'Disappears', 'Reported by', 'Location']);
    expect(fields).toContain('Venore — Lair \\\\*-2\\\\*'); // city + markdown-escaped location
    expect(fields).not.toContain('Additional info');
    expect(fields).toContain(`<t:${unixSeconds('2026-10-29T12:07:00Z')}:R>`);
    expect(button).toMatchObject({ type: ComponentType.Button, label: 'Killed', style: ButtonStyle.Success, disabled: false });
    expect(parseKillCustomId(button.custom_id)).toEqual({
      kind: 'button',
      spawnId: 'c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b',
      monsterId: 142,
      serverName: 'Monza',
    });
  });

  it('shows the creature GIF as thumbnail when the event has one', () => {
    expect(render().embed.thumbnail).toEqual({ url: 'https://static.wikia.nocookie.net/tibia/images/e/e0/Dragon.gif' });
    expect(render({}, { monster: { id: 1, name: 'Old', category: 'Dragons' } }).embed.thumbnail).toBeUndefined();
  });

  it('shows additional info when present', () => {
    const { embed } = render({}, { city: null, additional_info: 'Dwie osoby\nczekają' });

    expect(embed.fields).toContainEqual({ name: 'Location', value: 'Lair \\*-2\\*' });
    expect(embed.fields).toContainEqual({ name: 'Additional info', value: 'Dwie osoby\nczekają' });
  });

  it('disables the button once expired', () => {
    const { embed, button } = render({ expired: true });

    expect(button.disabled).toBe(true);
    expect(embed.footer.text).toBe('This report has expired');
  });
});

describe('custom ids', () => {
  it('fit within the 100 character Discord limit', () => {
    const id = killButtonId({ spawnId: 'c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b', monsterId: 2_147_483_647, serverName: 'Quintebra-Extra-Long' });
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it('ignore foreign ids', () => {
    expect(parseKillCustomId('something-else')).toBeNull();
    expect(parseKillCustomId('wk|abc|nope|Monza')).toBeNull();
  });
});

describe('mentionChunks', () => {
  it('puts the headline and mentions in one message when they fit', () => {
    expect(mentionChunks('**Hydra**', ['1', '2'])).toEqual(['**Hydra** <@1> <@2>']);
    expect(mentionChunks('**Hydra**', [])).toEqual(['**Hydra**']);
    expect(mentionChunks('**Hydra**', ['1'], undefined, ['77'])).toEqual(['**Hydra** <@&77> <@1>']);
  });

  it('starts a new message when the limit would be exceeded', () => {
    expect(mentionChunks('**Hydra**', ['111', '222', '333'], 20)).toEqual(['**Hydra** <@111>', '<@222> <@333>']);
  });
});

describe('reading back a posted alert', () => {
  it('finds the spawn id and expiry of an active alert', () => {
    const alert = parsePostedAlert(postedAlert(spawnFixture()) as never);

    expect(alert).toEqual({ spawnId: 'c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b', expiresAt: new Date('2026-10-29T12:07:00Z') });
  });

  it('also reads an alert already marked as expired', () => {
    const message = postedAlert(spawnFixture(), { expired: true });

    expect(parsePostedAlert(message as never)?.expiresAt).toEqual(new Date('2026-10-29T12:07:00Z'));
    expect(allButtonsDisabled(message as never)).toBe(true);
  });

  it('ignores messages that are not alerts', () => {
    expect(parsePostedAlert({ embeds: [], components: [] } as never)).toBeNull();
  });

  it('disables every button of a posted alert', () => {
    const rows = disabledButtonRows(postedAlert(spawnFixture()) as never).map((row) => row.toJSON());

    expect(rows[0]!.components[0]).toMatchObject({ label: 'Killed', disabled: true });
  });
});

describe('presence buttons and lists', () => {
  const embed = () => (buildSpawnMessage(spawnFixture()).embeds![0] as { toJSON(): any }).toJSON();

  it('adds [OMW] and [On site] next to [Killed] only when requested', () => {
    const withButtons = (buildSpawnMessage(spawnFixture(), { onMyWay: true }).components![0] as { toJSON(): any }).toJSON();
    const without = (buildSpawnMessage(spawnFixture()).components![0] as { toJSON(): any }).toJSON();

    expect(withButtons.components.map((c: { label: string }) => c.label)).toEqual(['Killed', 'OMW', 'On site', 'Gone']);
    expect(without.components).toHaveLength(1);
  });

  it('round-trips both lists through the embed and drops empty fields', () => {
    const listed = withPresence(embed(), { onMyWay: ['111', '222'], onSite: ['333'] }).toJSON();
    expect(listed.fields).toContainEqual({ name: 'On my way (2)', value: '<@111>, <@222>' });
    expect(listed.fields).toContainEqual({ name: 'On site (1)', value: '<@333>' });
    expect(presenceOf(listed)).toEqual({ onMyWay: ['111', '222'], onSite: ['333'] });

    const emptied = withPresence(listed, { onMyWay: [], onSite: [] }).toJSON();
    expect(emptied.fields).toHaveLength(embed().fields.length);
  });

  it('keeps a player on at most one list', () => {
    const start = { onMyWay: ['111'], onSite: [] };

    const arrived = togglePresence(start, 'onSite', '111');
    expect(arrived).toEqual({ onMyWay: [], onSite: ['111'] });
    expect(togglePresence(arrived, 'onMyWay', '111')).toEqual({ onMyWay: ['111'], onSite: [] });
    expect(togglePresence(arrived, 'onSite', '111')).toEqual({ onMyWay: [], onSite: [] });
  });

  it('keeps each field within the 1024 character limit', () => {
    const ids = Array.from({ length: 80 }, (_, i) => String(100000000000000000n + BigInt(i)));

    const field = withPresence(embed(), { onMyWay: ids, onSite: [] }).toJSON().fields!.find((f) => f.name.startsWith('On my way'))!;

    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.name).toBe('On my way (80)');
    expect(field.value).toMatch(/\+\d+$/);
  });

  it('carries the alert message id through the character select', () => {
    const id = killSelectId({ spawnId: 's1', monsterId: 142, serverName: 'Monza', alertMessageId: '1234567890123456789' });

    expect(parseKillCustomId(id)).toEqual({ kind: 'select', spawnId: 's1', monsterId: 142, serverName: 'Monza', alertMessageId: '1234567890123456789' });
    expect(presenceListOf(presenceButtonId('onMyWay', 's1'))).toBe('onMyWay');
    expect(presenceListOf(presenceButtonId('onSite', 's1'))).toBe('onSite');
    expect(presenceListOf(killButtonId({ spawnId: 's1', monsterId: 1, serverName: 'Monza' }))).toBeNull();
    expect(parseKillCustomId(presenceButtonId('onSite', 's1'))).toBeNull();
  });
});

describe('alerts posted before the switch to English', () => {
  it('are still read back (expiry and "W drodze" list)', () => {
    const message = postedAlert(spawnFixture());
    const fields = message.embeds[0]!.fields.map((f) => (f.name === 'Disappears' ? { ...f, name: 'Znika' } : f));
    const legacy = { ...message, embeds: [{ fields: [...fields, { name: 'W drodze (1)', value: '<@111>' }] }] };

    expect(parsePostedAlert(legacy as never)?.expiresAt).toEqual(new Date('2026-10-29T12:07:00Z'));
    expect(presenceOf(legacy.embeds[0]).onMyWay).toEqual(['111']);
  });
});

describe('bestiary link', () => {
  const url = bestiaryUrlOf('https://warden.example/');

  it('adds a link to the web app bestiary after the other buttons', () => {
    const row = (buildSpawnMessage(spawnFixture(), { onMyWay: true, bestiaryUrl: url }).components![0] as { toJSON(): any }).toJSON();
    expect(row.components.at(-1)).toMatchObject({ style: ButtonStyle.Link, url: 'https://warden.example/#bestiary', label: 'My bestiary' });
  });

  it('keeps the link usable when the alert expires', () => {
    const alert = postedAlert(spawnFixture(), { onMyWay: true, bestiaryUrl: url });
    const rows = disabledButtonRows(alert as never).map((row) => row.toJSON());
    const buttons = rows[0]!.components as { style: number; disabled?: boolean }[];

    expect(buttons.filter((b) => b.style !== ButtonStyle.Link).every((b) => b.disabled)).toBe(true);
    expect(buttons.find((b) => b.style === ButtonStyle.Link)?.disabled).toBe(false);
    expect(allButtonsDisabled({ ...alert, components: rows.map((r) => ({ type: r.type, components: r.components.map((c: any) => ({ ...c, customId: c.custom_id, toJSON: () => c })) })) } as never)).toBe(true);
  });
});
