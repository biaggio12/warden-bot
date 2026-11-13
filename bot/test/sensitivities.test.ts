import { afterEach, describe, expect, it } from 'vitest';
import { buildSpawnMessage, finishedEmbed, killedAlert } from '../src/messages.js';
import { formatSensitivities, sensitivitiesOf, setElementEmojis } from '../src/sensitivities.js';
import { spawnFixture } from './fixtures.js';

const ALL_EMOJIS = ['physical', 'earth', 'fire', 'death', 'energy', 'holy', 'ice'].map((name, i) => ({ id: String(i + 1), name }));

afterEach(() => {
  setElementEmojis([]);
});

describe('sensitivities', () => {
  it('knows the damage a creature takes from each element, by name in any case', () => {
    expect(sensitivitiesOf('dragon lord')).toEqual({ physical: 100, earth: 20, fire: 0, death: 100, energy: 80, holy: 100, ice: 110 });
    expect(sensitivitiesOf('Nobody Knows Me')).toBeNull();
  });

  it('shows one element per line with its emoji, most damage first', () => {
    setElementEmojis(ALL_EMOJIS);
    expect(formatSensitivities('Dragon Lord')).toBe(
      ['<:ice:7> 110%', '<:physical:1> 100%', '<:death:4> 100%', '<:holy:6> 100%', '<:energy:5> 80%', '<:earth:2> 20%', '<:fire:3> 0%'].join('\n'),
    );
  });

  it('falls back to :name: for an emoji the bot cannot see', () => {
    setElementEmojis([{ id: '9', name: 'Ice', animated: true }, { id: null, name: 'fire' }]);
    expect(formatSensitivities('Dragon Lord')).toBe(
      ['<a:Ice:9> 110%', ':physical: 100%', ':death: 100%', ':holy: 100%', ':energy: 80%', ':earth: 20%', ':fire: 0%'].join('\n'),
    );
  });

  it('adds a Sensitivities field to the alert for a known creature only', () => {
    setElementEmojis(ALL_EMOJIS);
    const fieldsOf = (name: string) =>
      (buildSpawnMessage(spawnFixture({ monster: { id: 1, name, category: 'Dragon' } })).embeds![0] as { toJSON(): any }).toJSON().fields;

    expect(fieldsOf('Dragon Lord')).toContainEqual({ name: 'Sensitivities', value: expect.stringContaining('<:earth:2> 20%') });
    expect(fieldsOf('Dragon Warden').map((f: { name: string }) => f.name)).not.toContain('Sensitivities');
  });
});

describe('sensitivities once the report is over', () => {
  const live = () => {
    setElementEmojis(ALL_EMOJIS);
    return (buildSpawnMessage(spawnFixture({ monster: { id: 1, name: 'Dragon Lord', category: 'Dragon' } })).embeds![0] as { toJSON(): any }).toJSON();
  };
  const names = (embed: { fields?: { name: string }[] }) => (embed.fields ?? []).map((f) => f.name);

  it('are left out of an expired alert', () => {
    const expired = buildSpawnMessage(spawnFixture({ monster: { id: 1, name: 'Dragon Lord', category: 'Dragon' } }), { expired: true });
    expect(names((expired.embeds![0] as { toJSON(): any }).toJSON())).not.toContain('Sensitivities');
  });

  it('are removed when the Warden is marked dead', () => {
    const embed = live();
    expect(names(embed)).toContain('Sensitivities');
    expect(names(killedAlert(embed, '<@1>', new Date()).toJSON())).not.toContain('Sensitivities');
  });

  it('are removed from an alert retired after a restart, keeping the other fields', () => {
    const embed = live();
    expect(names(finishedEmbed(embed).toJSON())).toEqual(names(embed).filter((n) => n !== 'Sensitivities'));
  });
});
