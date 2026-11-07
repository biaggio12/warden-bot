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

/**
 * Creature GIF on Tibiopedia. Discord's proxy shows Fandom's GIFs as still WebP frames, Tibiopedia's animate.
 * Its file names are the lowercase name with `_` for spaces, no apostrophes, and the wiki's
 * "(Creature)"/"(Basic)" disambiguators dropped: "Mooh'Tah Warrior" → moohtah_warrior, "Horse (Brown)" → horse_brown.
 */
export function tibiopediaImageUrl(monsterName: string): string {
  const slug = monsterName
    .toLowerCase()
    .replace(/\s*\((creature|basic)\)/g, '')
    .replace(/['()]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `https://tibiopedia.pl/images/static/monsters/${encodeURIComponent(slug)}.gif`;
}

const KILL_BUTTON_PREFIX = 'wk';
const KILL_SELECT_PREFIX = 'wks';
/** [Dead] asks for confirmation; the confirm button then closes the report for everyone. */
const GONE_BUTTON_PREFIX = 'gone';
const GONE_CONFIRM_PREFIX = 'gone!';
/** Footer of channel alerts: what each button means. */
export const ALERT_HELP = [
  '🏃 OMW: you are on your way · 🚫 No Need: the reporter lets anyone mark it Dead',
  '⚔️ Hit / Completed ✅: you attacked it, marks it in your bestiary.',
].join('\n');
/** [My characters]: tells the player privately which of their characters still need the monster. */
const CHECK_BUTTON_PREFIX = 'chk';
/**
 * Who is heading to a Warden and who is already there. Each list lives in an embed field
 * of the alert itself; a player is on at most one of them.
 */
export type PresenceList = 'onMyWay' | 'onSite';

const PRESENCE: Record<PresenceList, { prefix: string; field: string; legacyField?: string }> = {
  // "W drodze": alerts posted before the bot switched to English, still recognised when read back.
  onMyWay: { prefix: 'omw', field: 'On my way', legacyField: 'W drodze' },
  // [No Need] (formerly [On site]); the list keeps its old id and storage column.
  onSite: { prefix: 'here', field: 'No need', legacyField: 'On site' },
};
const PRESENCE_ORDER: PresenceList[] = ['onMyWay', 'onSite'];
/** Field names of alerts posted before the bot switched to English, still recognised when read back. */
const EXPIRY_FIELDS = ['Disappears', 'Expired', 'Znika', 'Wygasło'];
/** Embed field values are capped at 1024 characters. */
const FIELD_VALUE_LIMIT = 1024;
/** Players named on a presence list; the rest are counted as "+N". */
export const PRESENCE_VISIBLE = 10;
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

export function goneButtonId(spawnId: string, confirm = false): string {
  return [confirm ? GONE_CONFIRM_PREFIX : GONE_BUTTON_PREFIX, spawnId].join(SEPARATOR);
}

export function checkButtonId(monsterId: number, serverName: string): string {
  return [CHECK_BUTTON_PREFIX, monsterId, serverName].join(SEPARATOR);
}

/** The monster and world of a [My characters] button, or null for other buttons. */
export function parseCheckCustomId(customId: string): { monsterId: number; serverName: string } | null {
  const [prefix, monsterId, serverName] = customId.split(SEPARATOR);
  if (prefix !== CHECK_BUTTON_PREFIX || !serverName || !/^\d+$/.test(monsterId ?? '')) {
    return null;
  }
  return { monsterId: Number(monsterId), serverName };
}

/** The private answer to [My characters], like the "Missing on" line of the website. */
export function characterCheck(monsterName: string, serverName: string, missing: string[], done: string[]): string {
  const names = (list: string[]) => list.map((name) => `**${escapeMarkdown(name)}**`).join(', ');
  const monster = `**${escapeMarkdown(monsterName)}**`;
  if (missing.length === 0) {
    return `✅ All your characters on ${escapeMarkdown(serverName)} have ${monster} already: ${names(done)}.`;
  }
  const lines = [`🔍 ${monster} on ${escapeMarkdown(serverName)}:`, `❌ Missing on ${names(missing)}`];
  if (done.length > 0) lines.push(`✅ Has it: ${names(done)}`);
  return lines.join('\n');
}

/** The spawn a [Gone] button (or its confirmation) belongs to, or null for other buttons. */
export function parseGoneCustomId(customId: string): { spawnId: string; confirm: boolean } | null {
  const [prefix, spawnId] = customId.split(SEPARATOR);
  if (!spawnId || (prefix !== GONE_BUTTON_PREFIX && prefix !== GONE_CONFIRM_PREFIX)) {
    return null;
  }
  return { spawnId, confirm: prefix === GONE_CONFIRM_PREFIX };
}

/** Which presence list a button toggles, or null for other buttons. */
export function presenceListOf(customId: string): PresenceList | null {
  return PRESENCE_ORDER.find((list) => customId.startsWith(PRESENCE[list].prefix + SEPARATOR)) ?? null;
}

/** The spawn an [OMW] / [No Need] button belongs to. */
export function spawnIdOfPresenceButton(customId: string): string | null {
  return presenceListOf(customId) ? customId.split(SEPARATOR)[1] || null : null;
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
  /** Link button to the web app's bestiary, where players update which Wardens they have. */
  bestiaryUrl?: string;
  /** Adds the [OMW], [No Need] and [Dead] buttons; only channel alerts have shared presence lists. */
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
      { name: 'Reported by', value: reporterOf(spawn), inline: true },
      {
        name: 'Location',
        value: escapeMarkdown(spawn.city ? `${spawn.city} — ${spawn.location_description}` : spawn.location_description),
      },
    )
    .setTimestamp(new Date(spawn.created_at));

  embed.setThumbnail(tibiopediaImageUrl(spawn.monster.name));
  if (spawn.additional_info) {
    embed.addFields({ name: 'Additional info', value: escapeMarkdown(spawn.additional_info).slice(0, 1024) });
  }
  if (options.note) {
    embed.setDescription(options.note);
  }
  if (expired) {
    embed.setFooter({ text: 'This report has expired' });
  } else if (options.onMyWay) {
    embed.setFooter({ text: ALERT_HELP });
  }

  const button = new ButtonBuilder()
    .setCustomId(killButtonId({ spawnId: spawn.spawn_id, monsterId: spawn.monster.id, serverName: spawn.server_name }))
    .setLabel('Hit / Completed ✅')
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
        .setLabel('No Need')
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(expired),
      new ButtonBuilder()
        .setCustomId(goneButtonId(spawn.spawn_id))
        .setLabel('Dead')
        .setEmoji('☠️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(expired),
    );
  }

  if (options.bestiaryUrl) {
    // A link stays usable after the report is over: updating the bestiary is never too late.
    row.addComponents(new ButtonBuilder().setURL(options.bestiaryUrl).setLabel('My bestiary').setEmoji('📖').setStyle(ButtonStyle.Link));
  }

  const rows = [row];
  if (options.onMyWay) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(checkButtonId(spawn.monster.id, spawn.server_name))
          .setLabel('My characters')
          .setEmoji('🔍')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(expired),
      ),
    );
  }

  return { embeds: [embed], components: rows };
}

/** The web app page where players mark the monsters their characters have. */
export function bestiaryUrlOf(frontendUrl: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/#bestiary`;
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
 * other one (a player is either on the way or does not need it, never both).
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
 * Mentions inside embeds show names but never ping anyone. A list names the first
 * PRESENCE_VISIBLE players and shows the rest as "+N", while the bot keeps the full
 * lists in memory (see AlertPresence).
 */
export function withPresence(embed: APIEmbed, presence: Presence): EmbedBuilder {
  const fields = (embed.fields ?? []).filter((f) => presenceListOfField(f.name) === null);

  for (const list of PRESENCE_ORDER) {
    const userIds = presence[list];
    if (userIds.length === 0) continue;
    const mentions: string[] = [];
    for (const id of userIds.slice(0, PRESENCE_VISIBLE)) {
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

/** Link buttons (the bestiary link) only open a page, so they are never disabled. */
function isLink(button: { toJSON(): unknown }): boolean {
  return (button.toJSON() as { style?: number }).style === ButtonStyle.Link;
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
  const buttons = buttonsOf(message).filter((button) => !isLink(button));
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
              .map((button) => ButtonBuilder.from(button.toJSON()).setDisabled(!isLink(button))),
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
 * Role mentions come first, so they always land in the alert itself.
 */
export function mentionChunks(headline: string, userIds: string[], limit = MAX_CONTENT_LENGTH, roleIds: string[] = []): string[] {
  const chunks: string[] = [headline];
  for (const mention of [...roleIds.map((id) => `<@&${id}>`), ...userIds.map((id) => `<@${id}>`)]) {
    const last = chunks[chunks.length - 1]!;
    if (last.length + 1 + mention.length <= limit) {
      chunks[chunks.length - 1] = `${last} ${mention}`;
    } else {
      chunks.push(mention);
    }
  }
  return chunks;
}

/**
 * allowedMentions for one chunk: only the ids it actually mentions, out of those meant to
 * be pinged. Discord rejects the whole message when either list has more than 100 ids,
 * and a chunk holds under 100 mentions, so the alert is posted however many get pinged.
 */
export function chunkMentions(content: string, userIds: string[], roleIds: string[] = []): { users: string[]; roles: string[] } {
  const users = new Set([...content.matchAll(/<@(\d+)>/g)].map((m) => m[1]!));
  const roles = new Set([...content.matchAll(/<@&(\d+)>/g)].map((m) => m[1]!));
  return { users: userIds.filter((id) => users.has(id)), roles: roleIds.filter((id) => roles.has(id)) };
}

export function buildDmNote(characters: CharacterRef[]): string {
  const names = characters.map((c) => `**${escapeMarkdown(c.name)}**`).join(', ');
  return characters.length === 1
    ? `Your character ${names} does not have this monster in the bestiary yet.`
    : `Your characters without this monster: ${names}.`;
}

/** The ephemeral "are you sure" shown after [Gone]: closing a report affects everyone. */
export function goneConfirmation(spawnId: string, monsterName: string | null): BaseMessageOptions {
  const name = monsterName ? `**${escapeMarkdown(monsterName)}**` : 'this Warden';
  const confirm = new ButtonBuilder().setCustomId(goneButtonId(spawnId, true)).setLabel("Yes, it's dead").setStyle(ButtonStyle.Danger);
  return {
    content: `Mark ${name} as dead for everyone? Players on the way will be told. Only do this if the Warden has been killed.`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirm)],
  };
}

/**
 * Who reported the Warden: their Discord mention (shows the name, pings nobody inside an
 * embed) and their characters on that world, the names they go by in game.
 */
export function reporterOf(spawn: WardenSpawned): string {
  const characters = spawn.reported_by_characters.map((name) => escapeMarkdown(name)).join(', ');
  const who = spawn.reported_by_discord_user_id
    ? `<@${spawn.reported_by_discord_user_id}>`
    : spawn.reported_by_name
      ? escapeMarkdown(spawn.reported_by_name)
      : null;
  if (who && characters) return `${who} (${characters})`;
  return who ?? (characters || 'a player');
}

/**
 * The reporter's Discord id from the alert's "Reported by" field: null when the reporter
 * has no Discord account, undefined for alerts without the field (posted before it
 * existed), which leaves the decision to the backend.
 */
export function reporterIdOfAlert(message: PostedMessage): string | null | undefined {
  const field = message.embeds[0]?.toJSON().fields?.find((f) => f.name === 'Reported by');
  if (!field) return undefined;
  return /^<@!?(\d+)>/.exec(field.value)?.[1] ?? null;
}

/** Who closed a report: a Discord mention (shows their name, pings nobody inside an embed) or their username. */
export function killerOf(event: { killed_by_discord_user_id: string | null; killed_by_name: string | null }): string {
  if (event.killed_by_discord_user_id) return `<@${event.killed_by_discord_user_id}>`;
  return event.killed_by_name ? `**${escapeMarkdown(event.killed_by_name)}**` : 'a player on the web app';
}

/**
 * The alert after [Gone]: marked dead with who reported it, buttons disabled, and the
 * presence lists left as they were, so everyone sees who was on the way. It stays up
 * until the report's original time runs out.
 */
export function killedAlert(embed: APIEmbed, killer: string, at: Date): EmbedBuilder {
  return EmbedBuilder.from(embed)
    .setTitle((embed.title ?? '').replace(/^\S+\s+/, '💀 '))
    .setColor(0xb91c1c)
    .setDescription(`**Killed**, reported by ${killer} ${time(at, TimestampStyles.RelativeTime)}. No need to come.`)
    .setFooter({ text: 'The Warden was killed' });
}

/** The ping to players on the way: edits do not notify, a new message does. */
export function killNotice(monsterName: string | null, killer: string, userIds: string[]): string[] {
  const name = monsterName ? `**${escapeMarkdown(monsterName)}**` : 'The Warden';
  return mentionChunks(`💀 ${name} is dead, reported by ${killer}. No need to come:`, userIds);
}

/** Monster name from an alert's embed title (an emoji, a space, the name). */
export function monsterNameOfAlert(message: PostedMessage): string | null {
  return message.embeds[0]?.title?.replace(/^\S+\s+/, '') || null;
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
