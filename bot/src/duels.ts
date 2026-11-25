import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TimestampStyles,
  escapeMarkdown,
  time,
  type BaseMessageOptions,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import type { ApiClient } from './api.js';
import type { DuelExpired, DuelFinished } from './events.js';

/**
 * Duels: two players race to report more Wardens in the agreed time. The backend counts
 * only reports that earn points: confirmed by someone else ([OMW] or a kill) and not a
 * duplicate of another report of the same Warden. A player is in one duel at a time.
 */

export const DUEL_MINUTES = [15, 30, 60, 120, 180] as const;
/** Mirrors the backend: the latest a result comes after the end, while a report from the duel is still up. */
export const SCORING_GRACE_MINUTES = 10;
export const MAX_STAKE = 1000;

export interface DuelPlayer {
  name: string;
  discord_user_id: string | null;
  /** null before the duel starts; while it runs, the score so far. */
  score: number | null;
  is_you: boolean;
}

export type DuelStatus = 'pending' | 'active' | 'finished' | 'declined' | 'expired';

export interface Duel {
  id: string;
  status: DuelStatus;
  minutes: number;
  /** Points the winner takes from the loser; 0 plays just for glory. */
  stake: number;
  created_at: string;
  accept_by: string;
  starts_at: string | null;
  ends_at: string | null;
  scored_at: string | null;
  challenger: DuelPlayer;
  opponent: DuelPlayer;
  result: 'challenger' | 'opponent' | 'draw' | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
}

export interface DuelRecord {
  won: number;
  lost: number;
  drawn: number;
}

export interface DuelList {
  current: Duel | null;
  recent: Duel[];
  record: DuelRecord;
}

export type PointsPeriod = '7d' | '30d' | 'all';

export interface PointsSummary {
  period: PointsPeriod;
  points: number;
  rank: number | null;
  players: number;
  top: { rank: number; player: string; points: number; is_you: boolean }[];
  duels: DuelRecord;
}

const PERIOD_LABELS: Record<PointsPeriod, string> = { '7d': 'last 7 days', '30d': 'last 30 days', all: 'all time' };

/** Points for a counted report by the Warden's bestiary difficulty; mirrors the backend's ReportScoring. */
export const DIFFICULTY_POINTS = { Harmless: 1, Trivial: 2, Easy: 3, Medium: 4, Hard: 10, Challenging: 25 } as const;

const SCORING_RULES =
  'A report counts once it is confirmed (💀 Dead clicked, or another player clicks 🏃 OMW or marks it killed) ' +
  'and nobody reported the same Warden in the 10 minutes before. Points by difficulty: ' +
  Object.entries(DIFFICULTY_POINTS)
    .map(([difficulty, points]) => `${difficulty} ${points}`)
    .join(' · ') +
  '.';

export const duelCommand = new SlashCommandBuilder()
  .setName('duel')
  .setDescription('Challenge another player: who scores more Warden points in a set time')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('challenge')
      .setDescription('Challenge a player to a Warden-reporting duel')
      .addUserOption((o) => o.setName('opponent').setDescription('Who you challenge').setRequired(true))
      .addIntegerOption((o) =>
        o
          .setName('minutes')
          .setDescription('How long the duel lasts')
          .setRequired(true)
          .addChoices(...DUEL_MINUTES.map((m) => ({ name: m < 60 ? `${m} min` : `${m / 60} h`, value: m }))),
      )
      .addIntegerOption((o) =>
        o
          .setName('stake')
          .setDescription('Points the winner takes from the loser (default 0: just for glory)')
          .setMinValue(0)
          .setMaxValue(MAX_STAKE),
      ),
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Your current duel and its score so far'))
  .addSubcommand((sub) => sub.setName('cancel').setDescription('Take back your challenge before it is accepted'));

export const pointsCommand = new SlashCommandBuilder()
  .setName('points')
  .setDescription('Your points for confirmed Warden reports (more for harder Wardens), and the top players')
  .addStringOption((o) =>
    o
      .setName('period')
      .setDescription('Which period (default: last 30 days)')
      .addChoices({ name: 'Last 7 days', value: '7d' }, { name: 'Last 30 days', value: '30d' }, { name: 'All time', value: 'all' }),
  );

const BUTTON_PREFIX = 'duel';
const SEPARATOR = '|';

export function duelButtonId(action: 'accept' | 'decline', duelId: string): string {
  return [BUTTON_PREFIX, action, duelId].join(SEPARATOR);
}

export function parseDuelButtonId(customId: string): { action: 'accept' | 'decline'; duelId: string } | null {
  const [prefix, action, duelId] = customId.split(SEPARATOR);
  if (prefix !== BUTTON_PREFIX || (action !== 'accept' && action !== 'decline') || !duelId) return null;
  return { action, duelId };
}

type Named = { name: string; discord_user_id: string | null };

function who(player: Named): string {
  return player.discord_user_id ? `<@${player.discord_user_id}>` : `**${escapeMarkdown(player.name)}**`;
}

function duration(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

function stakeLine(stake: number): string {
  return stake > 0 ? `🪙 **${stake}** point(s) at stake: the winner takes them from the loser.` : 'Played for glory (no points at stake).';
}

function score(duel: Duel): string {
  return `${who(duel.challenger)} **${duel.challenger.score ?? 0}** : **${duel.opponent.score ?? 0}** ${who(duel.opponent)}`;
}

/** Only the two players may be pinged, never anyone named in a username. */
function mentions(...ids: (string | null)[]): BaseMessageOptions['allowedMentions'] {
  return { parse: [], users: ids.filter((id): id is string => !!id) };
}

export function challengeMessage(duel: Duel): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('⚔️ Duel challenge')
    .setDescription(`${who(duel.challenger)} challenges ${who(duel.opponent)}: who scores more points for Wardens in **${duration(duel.minutes)}**?`)
    .addFields(
      { name: 'Stake', value: stakeLine(duel.stake) },
      { name: 'Answer by', value: `${time(new Date(duel.accept_by), TimestampStyles.ShortTime)} (${time(new Date(duel.accept_by), TimestampStyles.RelativeTime)})` },
      { name: 'Scoring', value: SCORING_RULES },
    );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(duelButtonId('accept', duel.id)).setLabel('Accept').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(duelButtonId('decline', duel.id)).setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
  return {
    content: duel.opponent.discord_user_id ? `<@${duel.opponent.discord_user_id}>` : undefined,
    embeds: [embed],
    components: [buttons],
    allowedMentions: mentions(duel.opponent.discord_user_id),
  };
}

export function activeMessage(duel: Duel): BaseMessageOptions {
  const ends = new Date(duel.ends_at!);
  const embed = new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle('⚔️ Duel on!')
    .setDescription(`${who(duel.challenger)} vs ${who(duel.opponent)}: who scores more points for Wardens in **${duration(duel.minutes)}**.`)
    .addFields(
      { name: 'Stake', value: stakeLine(duel.stake) },
      { name: 'Ends', value: `${time(ends, TimestampStyles.ShortTime)} (${time(ends, TimestampStyles.RelativeTime)})` },
      {
        name: 'Result',
        value:
          'Posted here as soon as the duel ends. If a report of yours from the duel is still up then, ' +
          `once it is closed (💀 Dead or expired), at most ${SCORING_GRACE_MINUTES} min later. Check the score with \`/duel status\`.`,
      },
      { name: 'Scoring', value: SCORING_RULES },
    );
  return { content: '', embeds: [embed], components: [], allowedMentions: mentions() };
}

export function closedMessage(duel: { challenger: Named; opponent: Named }, how: 'declined' | 'cancelled' | 'expired'): BaseMessageOptions {
  const text = {
    declined: `${who(duel.opponent)} declined the duel.`,
    cancelled: `${who(duel.challenger)} took the challenge back.`,
    expired: `${who(duel.opponent)} did not answer in time.`,
  }[how];
  const embed = new EmbedBuilder().setColor(0x6b7280).setTitle('⚔️ Duel called off').setDescription(text);
  return { content: '', embeds: [embed], components: [], allowedMentions: mentions() };
}

export function finishedMessage(duel: DuelFinished): BaseMessageOptions {
  const { challenger, opponent } = duel;
  const winner = duel.result === 'challenger' ? challenger : duel.result === 'opponent' ? opponent : null;
  const embed = new EmbedBuilder()
    .setColor(winner ? 0x16a34a : 0x6b7280)
    .setTitle(winner ? `🏆 ${winner.name} wins the duel!` : '🤝 The duel is a draw')
    .setDescription(
      `${who(challenger)} **${challenger.score}** : **${opponent.score}** ${who(opponent)}\nPoints for confirmed Warden reports in ${duration(duel.minutes)}.` +
        (duel.stake > 0
          ? winner
            ? `\n🪙 ${who(winner)} takes **${duel.stake}** point(s) from ${who(winner === challenger ? opponent : challenger)}.`
            : `\n🪙 Nobody loses the **${duel.stake}** point(s) at stake.`
          : ''),
    );
  return { content: '', embeds: [embed], components: [], allowedMentions: mentions() };
}

export function statusMessage(list: DuelList): string {
  const record = `Your record: **${list.record.won}** won · **${list.record.lost}** lost · **${list.record.drawn}** drawn.`;
  const duel = list.current;
  if (!duel) {
    return `You are not in a duel. Start one with \`/duel challenge\`.\n${record}`;
  }
  if (duel.status === 'pending') {
    const waitingFor = duel.challenger.is_you ? `${who(duel.opponent)} to answer` : `you to answer ${who(duel.challenger)}'s challenge`;
    return `⏳ Waiting for ${waitingFor} (${duration(duel.minutes)}, ${duel.stake > 0 ? `${duel.stake} point(s) at stake` : 'for glory'}, expires ${time(new Date(duel.accept_by), TimestampStyles.RelativeTime)}).\n${record}`;
  }
  const ends = new Date(duel.ends_at!);
  const over = ends.getTime() <= Date.now();
  return (
    `⚔️ ${score(duel)} so far${duel.stake > 0 ? ` (🪙 ${duel.stake} at stake)` : ''}.\n` +
    (over
      ? `Time is up. The result comes once your reports from the duel are closed (💀 Dead or expired), ${time(new Date(duel.scored_at!), TimestampStyles.RelativeTime)} at the latest.`
      : `Ends ${time(ends, TimestampStyles.RelativeTime)}. Unconfirmed reports do not show yet.`) +
    `\n${record}`
  );
}

export function pointsMessage(summary: PointsSummary): string {
  const lines = [
    `🏅 **${summary.points}** point(s) (reports and duel stakes) in the ${PERIOD_LABELS[summary.period]}` +
      (summary.rank ? `: #${summary.rank} of ${summary.players}.` : '. Report a Warden others confirm to get on the board.'),
  ];
  if (summary.top.length > 0) {
    lines.push('', ...summary.top.map((row) => `${row.rank}. ${row.is_you ? '**' : ''}${escapeMarkdown(row.player)}${row.is_you ? '**' : ''}: ${row.points}`));
  }
  lines.push('', `Duels: **${summary.duels.won}** won · **${summary.duels.lost}** lost · **${summary.duels.drawn}** drawn.`, `-# ${SCORING_RULES}`);
  return lines.join('\n');
}

/**
 * /duel and /points, and the [Accept] / [Decline] buttons on a challenge. Button answers are
 * ephemeral; the challenge message itself is edited, so an error never replaces it.
 */
export class DuelCommands {
  constructor(private readonly api: ApiClient) {}

  async executeDuel(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'status') {
      await interaction.editReply({ content: statusMessage(await this.api.getDuels(interaction.user.id)), allowedMentions: mentions() });
      return;
    }

    if (sub === 'cancel') {
      const { current } = await this.api.getDuels(interaction.user.id);
      if (!current || current.status !== 'pending' || !current.challenger.is_you) {
        await interaction.editReply('You have no challenge waiting for an answer.');
        return;
      }
      const duel = await this.api.declineDuel(interaction.user.id, current.id);
      await this.editChallenge(interaction.client, duel, closedMessage(duel, 'cancelled'));
      await interaction.editReply('Challenge taken back.');
      return;
    }

    const missing = missingChannelPermissions(interaction);
    if (missing.length > 0) {
      await interaction.editReply(
        `⚠️ I cannot post the duel's result in this channel (missing: ${missing.join(', ')}). ` +
          'Use /duel in a channel where the bot can write, e.g. your #wardens- channel.',
      );
      return;
    }

    const opponent = interaction.options.getUser('opponent', true);
    if (opponent.bot) {
      await interaction.editReply('⚠️ Bots do not report Wardens. Pick a player.');
      return;
    }
    const duel = await this.api.createDuel(interaction.user.id, {
      opponent_discord_user_id: opponent.id,
      minutes: interaction.options.getInteger('minutes', true),
      stake: interaction.options.getInteger('stake') ?? 0,
      discord_channel_id: interaction.channelId,
    });
    // The private answer first: after an ephemeral defer, Discord makes the *first* follow-up
    // the deferred reply itself (ephemeral too), so the opponent would never see the challenge.
    await interaction.editReply(`Challenge sent to ${opponent}. It expires ${time(new Date(duel.accept_by), TimestampStyles.RelativeTime)}.`);
    // Public, so the opponent sees it and can click.
    const message = await interaction.followUp(challengeMessage(duel));
    await this.api.attachDuelMessage(duel.id, message.channelId, message.id).catch((error) =>
      console.warn('[duel] Could not save the challenge message:', (error as Error).message),
    );
  }

  async executePoints(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const period = (interaction.options.getString('period') ?? '30d') as PointsPeriod;
    await interaction.editReply(pointsMessage(await this.api.getPoints(interaction.user.id, period)));
  }

  /**
   * The challenge is edited through the click itself (deferUpdate + editReply): that works in any
   * channel, even one the bot cannot see. An error goes to the clicker only, the challenge stays.
   */
  async handleButton(
    interaction: ButtonInteraction,
    target: { action: 'accept' | 'decline'; duelId: string },
    describeError: (error: unknown) => string,
  ): Promise<void> {
    await interaction.deferUpdate();
    try {
      if (target.action === 'accept') {
        const duel = await this.api.acceptDuel(interaction.user.id, target.duelId);
        await interaction.editReply(activeMessage(duel));
        await interaction.followUp({
          content: `⚔️ Duel accepted! It ends ${time(new Date(duel.ends_at!), TimestampStyles.RelativeTime)}. Good hunting.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const duel = await this.api.declineDuel(interaction.user.id, target.duelId);
      const how = duel.challenger.is_you ? 'cancelled' : 'declined';
      await interaction.editReply(closedMessage(duel, how));
      await interaction.followUp({ content: how === 'cancelled' ? 'Challenge taken back.' : 'Duel declined.', flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('[duel] Button failed:', error);
      await interaction.followUp({ content: describeError(error), flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }

  private async editChallenge(client: Client, duel: Duel, message: BaseMessageOptions): Promise<void> {
    await editDuelMessage(client, duel.discord_channel_id, duel.discord_message_id, message);
  }
}

/** What the bot needs in the channel to post the challenge's result there later. */
export function missingChannelPermissions(interaction: Pick<ChatInputCommandInteraction, 'appPermissions' | 'channel'>): string[] {
  const permissions = interaction.appPermissions;
  if (!permissions) return [];
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [interaction.channel?.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
    [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  ];
  return needed.filter(([flag]) => !permissions.has(flag)).map(([, name]) => name);
}

async function editDuelMessage(client: Client, channelId: string | null, messageId: string | null, message: BaseMessageOptions): Promise<boolean> {
  if (!channelId || !messageId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const original = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (!original) return false;
  await original.edit(message);
  return true;
}

/** Events from the backend: a duel's result is in, or nobody answered a challenge. */
export class DuelAnnouncer {
  constructor(private readonly client: Client | null) {}

  async onFinished(duel: DuelFinished): Promise<void> {
    const result = finishedMessage(duel);
    if (!this.client) {
      console.info(`[duel] (dry run) ${duel.duel_id} finished ${duel.challenger.score}:${duel.opponent.score}`);
      return;
    }
    await editDuelMessage(this.client, duel.discord_channel_id, duel.discord_message_id, result).catch((error) =>
      console.warn('[duel] Could not update the challenge message:', (error as Error).message),
    );
    const ping = [duel.challenger.discord_user_id, duel.opponent.discord_user_id].filter((id): id is string => !!id);
    const channel = duel.discord_channel_id ? await this.client.channels.fetch(duel.discord_channel_id).catch(() => null) : null;
    if (!channel?.isSendable()) {
      // The bot cannot see the channel (anymore): the players get the result in a DM instead.
      console.warn(`[duel] Channel ${duel.discord_channel_id} of ${duel.duel_id} is gone or not writable: sending the result by DM`);
      await Promise.all(
        ping.map((id) =>
          this.client!.users.fetch(id)
            .then((user) => user.send({ ...result, allowedMentions: mentions() }))
            .catch((error) => console.warn(`[duel] Could not DM the result to ${id}:`, (error as Error).message)),
        ),
      );
      return;
    }
    // A new message pings both players; the edited challenge alone would not notify them.
    await channel.send({
      ...result,
      content: ping.map((id) => `<@${id}>`).join(' '),
      allowedMentions: mentions(...ping),
      reply: duel.discord_message_id ? { messageReference: duel.discord_message_id, failIfNotExists: false } : undefined,
    });
  }

  async onExpired(duel: DuelExpired): Promise<void> {
    if (!this.client) return;
    const players = {
      challenger: { name: 'The challenger', discord_user_id: duel.challenger_discord_user_id },
      opponent: { name: 'The opponent', discord_user_id: duel.opponent_discord_user_id },
    };
    await editDuelMessage(this.client, duel.discord_channel_id, duel.discord_message_id, closedMessage(players, 'expired'));
  }
}
