import {
  MessageFlags,
  SlashCommandBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type StringSelectMenuInteraction,
} from 'discord.js';
import * as Sentry from '@sentry/node';
import { AlertPresence } from './alertPresence.js';
import { ApiError, type ApiClient } from './api.js';
import {
  buildCharacterSelect,
  goneConfirmation,
  isInPresence,
  killConfirmation,
  leavePresence,
  monsterNameOfAlert,
  parseGoneCustomId,
  parseKillCustomId,
  presenceListOf,
  reporterIdOfAlert,
  togglePresence,
  type PresenceList,
  type KillTarget,
} from './messages.js';
import type { MonsterCatalog } from './monsterCatalog.js';
import { ReportCommand, UserError, reportCommand } from './reportCommand.js';

/** Same words as the backend's 403, for the answer given before asking it. */
const ONLY_THE_REPORTER = 'Only the player who reported this Warden can mark it as gone.';

export const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Warden Tracker account')
    .addStringOption((option) =>
      option.setName('code').setDescription('Code from the Warden Tracker web app (Characters tab)').setRequired(true).setMaxLength(16),
    ),
  reportCommand,
].map((command) => command.toJSON());

/**
 * Every handler defers first (ephemeral), so Discord's 3 s deadline is met even
 * when the API is slow, and nothing blocks the gateway event loop.
 */
export class InteractionHandler {
  private readonly report: ReportCommand;

  constructor(
    private readonly api: ApiClient,
    private readonly catalog: MonsterCatalog,
    private readonly frontendUrl: string,
    channelPrefix = 'wardens-',
    private readonly presence = new AlertPresence(),
  ) {
    this.report = new ReportCommand(api, catalog, channelPrefix);
  }

  async handle(interaction: Interaction): Promise<void> {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'report') {
        await this.report.autocomplete(interaction).catch((error) => console.warn('[interaction] Autocomplete failed:', error));
      }
      return;
    }
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'link') {
        await this.handleLink(interaction);
      } else if (interaction.isChatInputCommand() && interaction.commandName === 'report') {
        await this.report.execute(interaction);
      } else if (interaction.isButton() && parseGoneCustomId(interaction.customId)) {
        await this.handleGone(interaction, parseGoneCustomId(interaction.customId)!);
      } else if (interaction.isButton() && presenceListOf(interaction.customId)) {
        await this.handlePresence(interaction, presenceListOf(interaction.customId)!);
      } else if (interaction.isButton()) {
        const target = parseKillCustomId(interaction.customId);
        if (target?.kind === 'button') {
          await this.handleKillButton(interaction, target);
        }
      } else if (interaction.isStringSelectMenu()) {
        const target = parseKillCustomId(interaction.customId);
        if (target?.kind === 'select') {
          await this.handleCharacterSelect(interaction, target);
        }
      }
    } catch (error) {
      console.error('[interaction] Failed:', error);
      if (!isExpected(error)) {
        Sentry.captureException(error, { tags: { interaction: describeInteraction(interaction) } });
      }
      if (interaction.isRepliable()) {
        const content = this.errorMessage(error);
        await (interaction.deferred || interaction.replied
          ? interaction.editReply({ content, components: [] })
          : interaction.reply({ content, flags: MessageFlags.Ephemeral })
        ).catch(() => undefined);
      }
    }
  }

  private async handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const code = interaction.options.getString('code', true);
    const { display_name: account } = await this.api.linkDiscord(code, interaction.user.id);
    await interaction.editReply(
      `🔗 Linked to **${escapeMarkdown(account)}**. You will now be pinged about Wardens your characters are missing, and you can report them with \`/report\`.`,
    );
  }

  /**
   * [OMW] / [On site] put the player on that list of the alert (and off the other one);
   * clicking the same button again takes them off. The lists are stored in the alert
   * itself, so they survive restarts and each channel keeps its own. The click is
   * acknowledged at once; the edit goes through AlertPresence, so simultaneous clicks
   * all end up on the list.
   */
  private async handlePresence(interaction: ButtonInteraction, list: PresenceList): Promise<void> {
    await interaction.deferUpdate();
    const embed = interaction.message.embeds[0];
    if (!embed) {
      return;
    }
    await this.presence.change(
      interaction.message.id,
      embed.toJSON(),
      (presence) => togglePresence(presence, list, interaction.user.id),
      (next) => interaction.editReply({ embeds: [next] }),
    );
  }

  /**
   * [Gone] on the alert asks first (closing a report affects everyone); the confirm
   * button in that ephemeral reply closes it. Only the reporter may: they are at the
   * Warden and call the attack (the backend enforces it, this only answers at once). The backend then publishes warden.killed
   * and the notifier marks the alert dead and pings the players on the way.
   */
  private async handleGone(interaction: ButtonInteraction, gone: { spawnId: string; confirm: boolean }): Promise<void> {
    if (!gone.confirm) {
      const reporter = reporterIdOfAlert(interaction.message);
      if (reporter !== undefined && reporter !== interaction.user.id) {
        await interaction.reply({ content: `⚠️ ${ONLY_THE_REPORTER}`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ ...goneConfirmation(gone.spawnId, monsterNameOfAlert(interaction.message)), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferUpdate();
    await this.api.killSpawn(interaction.user.id, gone.spawnId);
    await interaction.editReply({ content: '💀 Marked as dead. Players on the way have been told.', components: [] });
  }

  /** After a successful kill the player is neither on the way nor waiting on site. */
  private async leavePresenceLists(alert: Message | null, userId: string): Promise<void> {
    const embed = alert?.embeds[0];
    if (!alert || !embed || !isInPresence(this.presence.of(alert.id, embed.toJSON()), userId)) {
      return;
    }
    await this.presence.change(
      alert.id,
      embed.toJSON(),
      (presence) => leavePresence(presence, userId),
      (next) => alert.edit({ embeds: [next] }),
    );
  }

  /** Scenario A: one character on that world -> mark immediately. Scenario B: ask which one. */
  private async handleKillButton(interaction: ButtonInteraction, target: KillTarget): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const characters = await this.api.getCharacters(interaction.user.id, target.serverName);
    const monsterName = await this.catalog.nameOf(target.monsterId);

    if (characters.length === 0) {
      await interaction.editReply(`You have no character on **${target.serverName}**. Add one in the web app: ${this.frontendUrl}`);
      return;
    }

    if (characters.length === 1) {
      const [character] = characters as [(typeof characters)[0]];
      const created = await this.api.markKilled(interaction.user.id, character.id, target.monsterId);
      await interaction.editReply(killConfirmation(monsterName, character.name, created));
      await this.leavePresenceLists(interaction.message, interaction.user.id);
      return;
    }

    await interaction.editReply({
      content: `Which character killed **${monsterName}**?`,
      components: [buildCharacterSelect({ ...target, alertMessageId: interaction.message.id }, characters)],
    });
  }

  private async handleCharacterSelect(interaction: StringSelectMenuInteraction, target: KillTarget): Promise<void> {
    await interaction.deferUpdate();

    const characterId = interaction.values[0];
    const characters = await this.api.getCharacters(interaction.user.id, target.serverName);
    const character = characters.find((c) => c.id === characterId);
    if (!character) {
      await interaction.editReply({ content: 'This character is no longer on your account.', components: [] });
      return;
    }

    const created = await this.api.markKilled(interaction.user.id, character.id, target.monsterId);
    const monsterName = await this.catalog.nameOf(target.monsterId);
    await interaction.editReply({ content: killConfirmation(monsterName, character.name, created), components: [] });

    if (target.alertMessageId && interaction.channel) {
      const alert = await interaction.channel.messages.fetch(target.alertMessageId).catch(() => null);
      await this.leavePresenceLists(alert, interaction.user.id);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof UserError) {
      return `⚠️ ${error.message}`;
    }
    if (error instanceof ApiError) {
      if (error.isDiscordNotLinked) {
        return `Your Discord account is not linked. Log in to the web app (${this.frontendUrl}) and link it, or generate a code there and use \`/link\`.`;
      }
      if (error.status === 403) {
        return error.problem?.detail ? `⚠️ ${error.problem.detail}` : 'This character does not belong to your account.';
      }
      const violation = error.problem?.violations?.[0]?.title;
      if (error.status < 500 && (violation ?? error.problem?.detail)) {
        return `⚠️ ${violation ?? error.problem?.detail}`;
      }
    }
    return '⚠️ Something went wrong. Please try again in a moment.';
  }
}

/** Player mistakes (not linked, bad input, 4xx from the API) are answered, not reported. */
function isExpected(error: unknown): boolean {
  return error instanceof UserError || (error instanceof ApiError && error.status < 500);
}

function describeInteraction(interaction: Interaction): string {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isButton() || interaction.isStringSelectMenu()) return interaction.customId.split('|')[0] ?? 'component';
  return String(interaction.type);
}
