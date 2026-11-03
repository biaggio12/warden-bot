import {
  MessageFlags,
  SlashCommandBuilder,
  TimestampStyles,
  escapeMarkdown,
  time,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ApiClient } from './api.js';
import { AlertChannels } from './alertChannels.js';
import { rankMatches, type MonsterCatalog } from './monsterCatalog.js';

/** A Warden disappears on its own 10 minutes after it shows up. */
export const TTL_CHOICES = [2, 4, 6, 8, 10] as const;
const DEFAULT_TTL = 8;

/** A problem the player can fix; its message is shown to them as is. */
export class UserError extends Error {}

export const reportCommand = new SlashCommandBuilder()
  .setName('warden')
  .setDescription('Report a Warden - an alert with pings goes to #wardens-<world>')
  .addStringOption((o) => o.setName('monster').setDescription('Which Warden appeared').setRequired(true).setAutocomplete(true))
  .addStringOption((o) => o.setName('city').setDescription('The nearest city').setRequired(true).setAutocomplete(true))
  .addStringOption((o) =>
    o.setName('location').setDescription('Exact spot, e.g. Dragon Lair -2, by the gate').setRequired(true).setMinLength(5).setMaxLength(255),
  )
  .addIntegerOption((o) =>
    o
      .setName('time')
      .setDescription(`Minutes until it disappears (default ${DEFAULT_TTL})`)
      .addChoices(...TTL_CHOICES.map((minutes) => ({ name: `${minutes} min`, value: minutes }))),
  )
  .addStringOption((o) => o.setName('info').setDescription('Additional info (optional)').setMaxLength(500));

/**
 * /warden reports a Warden as the linked player. The backend publishes the event and
 * the regular alert (with pings) follows, exactly as for a report from the web app.
 */
export class ReportCommand {
  constructor(
    private readonly api: ApiClient,
    private readonly catalog: MonsterCatalog,
    private readonly channelPrefix: string,
    private readonly channels = new AlertChannels(async () => [], channelPrefix),
  ) {}

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;

    const monsterInput = interaction.options.getString('monster', true);
    const monster = await this.catalog.resolve(monsterInput);
    if (!monster) {
      throw new UserError(`Unknown monster "${monsterInput}". Pick one from the suggestions.`);
    }

    const cityInput = interaction.options.getString('city', true);
    const city = (await this.catalog.cities.get()).find((c) => c.toLowerCase() === cityInput.trim().toLowerCase());
    if (!city) {
      throw new UserError(`Unknown city "${cityInput}". Pick one from the suggestions.`);
    }

    const world = await this.resolveWorld(interaction);
    const spawn = await this.api.reportSpawn(userId, {
      monster_id: monster.id,
      server_name: world,
      city,
      location_description: interaction.options.getString('location', true),
      additional_info: interaction.options.getString('info'),
      ttl_minutes: interaction.options.getInteger('time') ?? DEFAULT_TTL,
      discord_guild_id: interaction.guildId,
    });

    await interaction.editReply(
      `✅ Reported **${escapeMarkdown(spawn.monster.name)}** on **${spawn.server_name}** ` +
        `(${escapeMarkdown([spawn.city, spawn.location_description].filter(Boolean).join(' — '))}). ` +
        `It disappears ${time(new Date(spawn.expires_at), TimestampStyles.RelativeTime)}. ` +
        `The alert with pings will appear in ${await this.channels.describe(interaction.guildId, spawn.server_name)}.`,
    );
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    let choices: { name: string; value: string }[] = [];

    try {
      if (focused.name === 'monster') {
        choices = (await this.catalog.search(focused.value)).map((m) => ({ name: `${m.name} (${m.category})`, value: String(m.id) }));
      } else if (focused.name === 'city') {
        choices = rankMatches(await this.catalog.cities.get(), focused.value, (c) => c).map((c) => ({ name: c, value: c }));
      }
    } catch (error) {
      console.warn('[report] Autocomplete failed:', (error as Error).message);
    }

    await interaction.respond(choices.slice(0, 25));
  }

  /**
   * The world whose alerts this channel gets (chosen on the website, or in the name like
   * #wardens-monza), else the world where the player has the most characters (ties:
   * alphabetical) - the same rule as the web app's form.
   */
  private async resolveWorld(interaction: ChatInputCommandInteraction): Promise<string> {
    const channel =
      interaction.channel && 'name' in interaction.channel
        ? { id: interaction.channel.id, name: interaction.channel.name ?? '', guild: { id: interaction.guildId ?? '' } }
        : null;
    const fromChannel = channel ? await this.channels.worldOf(channel, await this.catalog.worlds.get()) : null;
    if (fromChannel) {
      return fromChannel;
    }

    const counts = new Map<string, number>();
    for (const character of await this.api.getCharacters(interaction.user.id)) {
      if (character.server_name) counts.set(character.server_name, (counts.get(character.server_name) ?? 0) + 1);
    }
    const [world] = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0] ?? [];
    if (!world) {
      throw new UserError(`You have no characters yet. Add one in the web app, or use /warden in a #${this.channelPrefix}<world> channel.`);
    }
    return world;
  }
}

