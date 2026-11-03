import { CachedList } from "./monsterCatalog.js";

/** A channel an admin chose on the website for the alerts of one world on one server. */
export interface ChannelAssignment {
  guild_id: string;
  server_name: string;
  channel_id: string;
}

/** What the choice needs to know about a text channel. */
export interface ChannelLike {
  id: string;
  name: string;
  guild: { id: string };
}

/** Changes on the website reach the bot within this time. */
const REFRESH_MS = 60_000;

/**
 * Where alerts go. On each server a world's alerts go to the channel an admin chose for it
 * (kept by id, so any name works); a world without a choice uses #<prefix><world>.
 */
export class AlertChannels {
  private readonly assignments: CachedList<ChannelAssignment>;

  constructor(
    load: () => Promise<ChannelAssignment[]>,
    private readonly prefix: string,
    ttlMs = REFRESH_MS,
  ) {
    this.assignments = new CachedList(load, "alert channels", ttlMs);
  }

  /** The channels of `channels` that get the alerts of one world, or of any world when omitted. */
  async select<T extends ChannelLike>(
    channels: T[],
    serverName?: string,
  ): Promise<T[]> {
    return selectAlertChannels(
      channels,
      await this.assignments.get(),
      this.prefix,
      serverName,
    );
  }

  /** The world whose alerts this channel gets, by choice or by name; null for other channels. */
  async worldOf(
    channel: ChannelLike,
    worlds: string[],
  ): Promise<string | null> {
    const chosen = (await this.assignments.get()).find(
      (a) => a.channel_id === channel.id,
    );
    if (chosen) {
      return chosen.server_name;
    }
    const name = channel.name.toLowerCase();
    if (!name.startsWith(this.prefix)) {
      return null;
    }
    return (
      worlds.find((w) => w.toLowerCase() === name.slice(this.prefix.length)) ??
      null
    );
  }

  /** How players are told where the alert appears. */
  async describe(guildId: string | null, serverName: string): Promise<string> {
    const chosen = (await this.assignments.get()).find(
      (a) =>
        a.guild_id === guildId &&
        a.server_name.toLowerCase() === serverName.toLowerCase(),
    );
    return chosen
      ? `<#${chosen.channel_id}>`
      : `#${this.prefix}${serverName.toLowerCase()}`;
  }
}

/** See AlertChannels.select. */
export function selectAlertChannels<T extends ChannelLike>(
  channels: T[],
  assignments: ChannelAssignment[],
  prefix: string,
  serverName?: string,
): T[] {
  if (serverName === undefined) {
    // Every channel that may hold alerts (the startup sweep).
    const chosen = new Set(assignments.map((a) => a.channel_id));
    return channels.filter(
      (c) => chosen.has(c.id) || c.name.startsWith(prefix),
    );
  }
  const world = serverName.toLowerCase();
  const forWorld = assignments.filter(
    (a) => a.server_name.toLowerCase() === world,
  );
  const chosen = new Set(forWorld.map((a) => a.channel_id));
  const serversWithChoice = new Set(forWorld.map((a) => a.guild_id));
  return channels.filter((c) =>
    serversWithChoice.has(c.guild.id)
      ? chosen.has(c.id)
      : c.name === `${prefix}${world}`,
  );
}
