import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TimestampStyles,
  time,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
} from 'discord.js';

/**
 * /maintenance start: before a deploy, an admin tells every alert channel that the bot is down
 * for a moment; /maintenance end: after it, that the bot works again. Only the Discord accounts in ADMIN_DISCORD_IDS (the website's admins) may post it:
 * the notice goes to every server the bot is in, so a server's own admins are not enough.
 * Discord shows the command only to members with Administrator, to keep it out of players' lists.
 */
export const maintenanceCommand = new SlashCommandBuilder()
  .setName('maintenance')
  .setDescription('Admins: tell every alert channel the bot is down for a moment while a new version is installed')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('The bot is down for a moment while a new version is installed')
      .addIntegerOption((option) =>
        option.setName('minutes').setDescription('About how long it will take (shown as "back around …")').setMinValue(1).setMaxValue(240),
      )
      .addStringOption((option) => option.setName('message').setDescription('An extra note for the players').setMaxLength(500)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('end')
      .setDescription('The new version is installed and the bot works again')
      .addStringOption((option) => option.setName('message').setDescription("What's new, or another note for the players").setMaxLength(500)),
  );

export interface MaintenanceNotice {
  /** When the bot should be back; null when the admin did not say. */
  backAt: Date | null;
  /** The admin's own words, if any. */
  note: string | null;
}

export function buildMaintenanceMessage(notice: MaintenanceNotice, now = new Date()): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🛠️ Bot update in progress')
    .setDescription(
      'The bot will be unavailable for a moment while a new version is installed. ' +
        'Buttons and commands may not respond until it is back.',
    )
    .setTimestamp(now);
  if (notice.backAt) {
    embed.addFields({
      name: 'Back',
      value: `around ${time(notice.backAt, TimestampStyles.ShortTime)} (${time(notice.backAt, TimestampStyles.RelativeTime)})`,
    });
  }
  embed.addFields({
    name: 'Reports',
    value: 'Reports made on the website in the meantime are not lost: their alerts are posted as soon as the bot is back.',
  });
  if (notice.note) {
    embed.addFields({ name: 'Note', value: notice.note });
  }
  // The note is the admin's text: it may not ping anyone.
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/** After the deploy: the bot works again. */
export function buildBackOnlineMessage(note: string | null, now = new Date()): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle('✅ Bot is back')
    .setDescription('The new version is installed and the bot works again: alerts, buttons and commands are back.')
    .setTimestamp(now);
  if (note) {
    embed.addFields({ name: 'Note', value: note });
  }
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/** A notice older than this is not posted: the bot was down when it was sent, so the update is over. */
export const STALE_NOTICE_MS = 5 * 60_000;

/**
 * The notice an admin posted on the website (bot.maintenance event). Returns null when it
 * waited in the queue too long (the bot was already down), as it would announce a downtime
 * that has passed.
 */
export function noticeFromEvent(event: { occurred_at: string; data: { back_at: string | null; note: string | null } }, now = new Date()): MaintenanceNotice | null {
  const sentAt = new Date(event.occurred_at);
  if (now.getTime() - sentAt.getTime() > STALE_NOTICE_MS) return null;
  return { backAt: event.data.back_at ? new Date(event.data.back_at) : null, note: event.data.note };
}

export class MaintenanceCommand {
  constructor(
    private readonly adminIds: readonly string[],
    /** Posts the message in every alert channel; returns how many channels took it. */
    private readonly announce: (message: BaseMessageOptions) => Promise<number>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.adminIds.includes(interaction.user.id)) {
      await interaction.reply({ content: '⚠️ Only Warden Tracker admins can use this command.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const now = this.now();
    const ended = interaction.options.getSubcommand() === 'end';
    const note = interaction.options.getString('message')?.trim() || null;
    let message: BaseMessageOptions;
    if (ended) {
      message = buildBackOnlineMessage(note, now);
    } else {
      const minutes = interaction.options.getInteger('minutes');
      message = buildMaintenanceMessage({ backAt: minutes ? new Date(now.getTime() + minutes * 60_000) : null, note }, now);
    }
    const posted = await this.announce(message);

    const what = ended ? '"Bot is back" notice' : 'Maintenance notice';
    console.info(`[maintenance] ${what} from ${interaction.user.tag} posted in ${posted} channel(s)`);
    await interaction.editReply(posted > 0 ? `📢 ${what} posted in ${posted} alert channel(s).` : '⚠️ No alert channel took the notice (see the bot logs).');
  }
}
