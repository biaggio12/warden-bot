import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  TimestampStyles,
  ComponentType,
  escapeMarkdown,
  time,
  type APIEmbed,
  type BaseMessageOptions,
  type Message,
} from 'discord.js';
import type { CharacterRef } from './api.js';
import type { WardenSpawned } from './events.js';

const KILL_BUTTON_PREFIX = 'wk';
const KILL_SELECT_PREFIX = 'wks';
/**
 * Who is heading to a Warden and who is already there. Each list lives in an embed field
 * of the alert itself; a player is on at most one of them.
 */
export type PresenceList = 'onMyWay' | 'onSite';

const PRESENCE: Record<PresenceList, { prefix: string; field: string; legacyField?: string }> = {
  // "W drodze": alerts posted before the bot switched to English, still recognised when read back.
  onMyWay: { prefix: 'omw', field: 'On my way', legacyField: 'W drodze' },
  onSite: { prefix: 'here', field: 'On site' },
};
const PRESENCE_ORDER: PresenceList[] = ['onMyWay', 'onSite'];
/** Field names of alerts posted before the bot switched to English, still recognised when read back. */
const EXPIRY_FIELDS = ['Disappears', 'Expired', 'Znika', 'Wygasło'];
/** Embed field values are capped at 1024 characters. */
const FIELD_VALUE_LIMIT = 1024;
const SEPARATOR = '|';

export interface KillTarget {
  spawnId: string;
  monsterId: number;
  serverName: string;
  /** Channel alert the kill was started from, so the player can be taken off its "W drodze" list. */
  alertMessageId?: string;
}

export function killButtonId(target: KillTarget): string {
  return [KILL_BUTTON_PREFIX, target.spawnId, target.monsterId, target.serverName].join(SEPARATOR);
}

export function killSelectId(target: KillTarget): string {
  return [KILL_SELECT_PREFIX, target.spawnId, target.monsterId, target.serverName, target.alertMessageId ?? ''].join(SEPARATOR);
}

export function presenceButtonId(list: PresenceList, spawnId: string): string {
  return [PRESENCE[list].prefix, spawnId].join(SEPARATOR);
}

/** Which presence list a button toggles, or null for other buttons. */
export function presenceListOf(customId: string): PresenceList | null {
  return PRESENCE_ORDER.find((list) => customId.startsWith(PRESENCE[list].prefix + SEPARATOR)) ?? null;
}

/** Parses a custom id produced by killButtonId / killSelectId. */
export function parseKillCustomId(customId: string): (KillTarget & { kind: 'button' | 'select' }) | null {
  const [prefix, spawnId, monsterId, serverName, alertMessageId] = customId.split(SEPARATOR);
  const kind = prefix === KILL_BUTTON_PREFIX ? 'button' : prefix === KILL_SELECT_PREFIX ? 'select' : null;
  const id = Number(monsterId);
  if (kind === null || !spawnId || !serverName || !Number.isInteger(id)) {
    return null;
  }
  return { kind, spawnId, monsterId: id, serverName, ...(alertMessageId ? { alertMessageId } : {}) };
}

export function unixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export interface SpawnMessageOptions {
  /** Buttons disabled and the embed marked as expired. */
  expired?: boolean;
  /** Extra line for DMs, e.g. which of the player's characters still need the monster. */
  note?: string;
  /** Adds the [OMW] and [On site] buttons; only channel alerts have shared presence lists. */
  onMyWay?: boolean;
}

/**
 * The alert posted in #wardens-<world> and sent as DM. Uses Discord's native
 * <t:unix:R> timestamp so the countdown updates client-side.
 */
export function buildSpawnMessage(spawn: WardenSpawned, options: SpawnMessageOptions = {}): BaseMessageOptions {
  const expiresAt = new Date(spawn.expires_at);
  const expired = options.expired ?? false;

  const embed = new EmbedBuilder()
    .setTitle(`${expired ? '⌛' : '🐉'} ${spawn.monster.name}`)
    .setColor(expired ? 0x6b7280 : 0xf59e0b)
    .addFields(
      { name: 'Class', value: escapeMarkdown(spawn.monster.category), inline: true },
      {
        name: expired ? 'Expired' : 'Disappears',
        value: expired ? time(expiresAt, TimestampStyles.ShortTime) : `${time(expiresAt, TimestampStyles.RelativeTime)} (${time(expiresAt, TimestampStyles.ShortTime)})`,
        inline: true,
      },
      {
        name: 'Location',
        value: escapeMarkdown(spawn.city ? `${spawn.city} — ${spawn.location_description}` : spawn.location_description),
      },
    )
    .setTimestamp(new Date(spawn.created_at));

  if (spawn.monster.image_url?.startsWith('https://')) {
    embed.setThumbnail(spawn.monster.image_url);
  }
  if (spawn.additional_info) {
    embed.addFields({ name: 'Additional info', value: escapeMarkdown(spawn.additional_info).slice(0, 1024) });
  }
  if (options.note) {
    embed.setDescription(options.note);
  }
  if (expired) {
    embed.setFooter({ text: 'This report has expired' });
  }

  const button = new ButtonBuilder()
    .setCustomId(killButtonId({ spawnId: spawn.spawn_id, monsterId: spawn.monster.id, serverName: spawn.server_name }))
    .setLabel('Killed')
    .setEmoji('⚔️')
    .setStyle(ButtonStyle.Success)
    .setDisabled(expired);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  if (options.onMyWay) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(presenceButtonId('onMyWay', spawn.spawn_id))
        .setLabel('OMW')
        .setEmoji('🏃')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(expired),
      new ButtonBuilder()
        .setCustomId(presenceButtonId('onSite', spawn.spawn_id))
        .setLabel('On site')
        .setEmoji('📍')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(expired),
    );
  }

  return { embeds: [embed], components: [row] };
}

type EmbedLike = Pick<APIEmbed, 'fields'>;

export type Presence = Record<PresenceList, string[]>;

function presenceListOfField(name: string): PresenceList | null {
  return (
    PRESENCE_ORDER.find((list) => {
      const { field, legacyField } = PRESENCE[list];
      return name.startsWith(field) || (legacyField !== undefined && name.startsWith(legacyField));
    }) ?? null
  );
}

/** Discord user ids on the alert's presence lists. */
export function presenceOf(embed: EmbedLike | undefined): Presence {
  const presence: Presence = { onMyWay: [], onSite: [] };
  for (const field of embed?.fields ?? []) {
    const list = presenceListOfField(field.name);
    if (list) presence[list] = [...field.value.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]!);
  }
  return presence;
}

/**
 * Clicking a presence button: toggles the player on that list and takes them off the
 * other one (a player is either on the way or on site, never both).
 */
export function togglePresence(presence: Presence, list: PresenceList, userId: string): Presence {
  const without = (ids: string[]) => ids.filter((id) => id !== userId);
  const next: Presence = { onMyWay: without(presence.onMyWay), onSite: without(presence.onSite) };
  if (!presence[list].includes(userId)) next[list] = [...next[list], userId];
  return next;
}

/** Takes the player off both lists (after a kill). */
export function leavePresence(presence: Presence, userId: string): Presence {
  return { onMyWay: presence.onMyWay.filter((id) => id !== userId), onSite: presence.onSite.filter((id) => id !== userId) };
}

export function isInPresence(presence: Presence, userId: string): boolean {
  return presence.onMyWay.includes(userId) || presence.onSite.includes(userId);
}

/**
 * The alert's embed with its presence fields rewritten (empty lists are removed).
 * Mentions inside embeds show names but never ping anyone. Past ~45 players a list
 * shows the overflow as "+N", and those players drop off on the next change.
 */
export function withPresence(embed: APIEmbed, presence: Presence): EmbedBuilder {
  const fields = (embed.fields ?? []).filter((f) => presenceListOfField(f.name) === null);

  for (const list of PRESENCE_ORDER) {
    const userIds = presence[list];
    if (userIds.length === 0) continue;
    const mentions: string[] = [];
    for (const id of userIds) {
      if ([...mentions, `<@${id}>`].join(', ').length > FIELD_VALUE_LIMIT - 8) break;
      mentions.push(`<@${id}>`);
    }
    const hidden = userIds.length - mentions.length;
    fields.push({
      name: `${PRESENCE[list].field} (${userIds.length})`,
      value: mentions.join(', ') + (hidden > 0 ? ` +${hidden}` : ''),
    });
  }

  return EmbedBuilder.from(embed).setFields(fields);
}

type PostedMessage = Pick<Message, 'embeds' | 'components'>;

function buttonsOf(message: PostedMessage) {
  return message.components.flatMap((row) =>
    row.type === ComponentType.ActionRow ? row.components.filter((c) => c.type === ComponentType.Button) : [],
  );
}

/**
 * Reads back which spawn a message we posted belongs to and when it expires
 * (from the <t:unix> timestamp in its embed). null for anything that is not an alert.
 */
export function parsePostedAlert(message: PostedMessage): { spawnId: string; expiresAt: Date } | null {
  const target = buttonsOf(message)
    .map((button) => ('customId' in button && button.customId ? parseKillCustomId(button.customId) : null))
    .find((parsed) => parsed?.kind === 'button');
  const field = message.embeds[0]?.fields.find((f) => EXPIRY_FIELDS.includes(f.name));
  const unix = field?.value.match(/<t:(\d+):[a-zA-Z]>/)?.[1];

  return target && unix ? { spawnId: target.spawnId, expiresAt: new Date(Number(unix) * 1000) } : null;
}

export function allButtonsDisabled(message: PostedMessage): boolean {
  const buttons = buttonsOf(message);
  return buttons.length > 0 && buttons.every((button) => button.disabled);
}

/** The message's button rows with every button disabled. */
export function disabledButtonRows(message: PostedMessage): ActionRowBuilder<ButtonBuilder>[] {
  return message.components.flatMap((row) =>
    row.type === ComponentType.ActionRow
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            row.components
              .filter((c) => c.type === ComponentType.Button)
              .map((button) => ButtonBuilder.from(button.toJSON()).setDisabled(true)),
          ),
        ]
      : [],
  );
}

/** Discord's message content limit. */
export const MAX_CONTENT_LENGTH = 2000;

/** The plain-text line above the embed: just which Warden was reported. */
export function alertHeadline(spawn: WardenSpawned): string {
  return `**${escapeMarkdown(spawn.monster.name)}**`;
}

/**
 * Splits the ping into messages that fit Discord's content limit: the first one is
 * the headline followed by as many mentions as fit, the rest carry only mentions.
 */
export function mentionChunks(headline: string, userIds: string[], limit = MAX_CONTENT_LENGTH): string[] {
  const chunks: string[] = [headline];
  for (const mention of userIds.map((id) => `<@${id}>`)) {
    const last = chunks[chunks.length - 1]!;
    if (last.length + 1 + mention.length <= limit) {
      chunks[chunks.length - 1] = `${last} ${mention}`;
    } else {
      chunks.push(mention);
    }
  }
  return chunks;
}

export function buildDmNote(characters: CharacterRef[]): string {
  const names = characters.map((c) => `**${escapeMarkdown(c.name)}**`).join(', ');
  return characters.length === 1
    ? `Your character ${names} does not have this monster in the bestiary yet.`
    : `Your characters without this monster: ${names}.`;
}

export function buildCharacterSelect(target: KillTarget, characters: CharacterRef[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(killSelectId(target))
    .setPlaceholder('Choose a character')
    .addOptions(characters.slice(0, 25).map((c) => ({ label: c.name, value: c.id })));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function killConfirmation(monsterName: string, characterName: string, created: boolean): string {
  return created
    ? `✅ **${escapeMarkdown(monsterName)}** marked as killed for **${escapeMarkdown(characterName)}**.`
    : `ℹ️ **${escapeMarkdown(monsterName)}** was already marked as killed for **${escapeMarkdown(characterName)}**.`;
}
