import { SENSITIVITY_DATA } from './sensitivityData.js';

/** Elements in the order of Tibia's in-game bestiary, and of each row in SENSITIVITY_DATA. */
export const ELEMENTS = ['physical', 'earth', 'fire', 'death', 'energy', 'holy', 'ice'] as const;
export type Element = (typeof ELEMENTS)[number];

/** Order of the lines in the alert when values tie; the creature's weaknesses come first. */
const DISPLAY_ORDER: readonly Element[] = ['physical', 'death', 'holy', 'ice', 'fire', 'energy', 'earth'];

/** Name of the custom emoji for each element. */
export const ELEMENT_EMOJI_NAMES: Record<Element, string> = {
  physical: 'physical',
  earth: 'earth',
  fire: 'fire',
  death: 'death',
  energy: 'energy',
  holy: 'holy',
  ice: 'ice',
};

/** Shown instead of an emoji the bot cannot see: the emoji's name, e.g. `:physical:`. */
const fallbackLabel = (element: Element): string => `:${ELEMENT_EMOJI_NAMES[element]}:`;

const byName = new Map(Object.entries(SENSITIVITY_DATA).map(([name, values]) => [name.toLowerCase(), values]));

/** Damage the creature takes from each element, in percent; null when it is not in the data. */
export function sensitivitiesOf(monsterName: string): Record<Element, number> | null {
  const values = byName.get(monsterName.toLowerCase());
  if (!values) {
    return null;
  }
  return Object.fromEntries(ELEMENTS.map((element, i) => [element, values[i] ?? 100])) as Record<Element, number>;
}

/** Element -> emoji markup such as `<:earth:123>`, filled once the bot can see its servers' emojis. */
let elementEmojis: Partial<Record<Element, string>> = {};

export interface NamedEmoji {
  id: string | null;
  name: string | null;
  animated?: boolean | null;
}

/** Picks the element emojis by name out of the ones the bot can use; the first match wins. */
export function setElementEmojis(emojis: Iterable<NamedEmoji>): Partial<Record<Element, string>> {
  const found: Partial<Record<Element, string>> = {};
  for (const emoji of emojis) {
    if (!emoji.id || !emoji.name) {
      continue;
    }
    for (const element of ELEMENTS) {
      if (found[element] === undefined && emoji.name.toLowerCase() === ELEMENT_EMOJI_NAMES[element]) {
        found[element] = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
      }
    }
  }
  elementEmojis = found;
  return found;
}

/**
 * The alert's Sensitivities field: one line per element, most damage first, e.g.
 * `<:physical:1> 100%` ... `<:earth:2> 80%`.
 */
export function formatSensitivities(monsterName: string): string | null {
  const sensitivities = sensitivitiesOf(monsterName);
  if (!sensitivities) {
    return null;
  }
  return [...DISPLAY_ORDER]
    .sort((a, b) => sensitivities[b] - sensitivities[a])
    .map((element) => `${elementEmojis[element] ?? fallbackLabel(element)} ${sensitivities[element]}%`)
    .join('\n');
}
