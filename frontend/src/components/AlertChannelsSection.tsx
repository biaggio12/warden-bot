import { Fragment, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { AlertChannelSettings, DiscordChannel } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useToast } from './Toast';

type Server = AlertChannelSettings['servers'][number];

/**
 * Admins: which channel of each Discord server gets the alerts of a world. The bot reads
 * the channels from Discord; a choice is kept by channel id, so the channel can have any
 * name. A world without a choice uses the channel named <prefix><world>.
 */
export default function AlertChannelsSection({ onChange }: { onChange?: () => void }) {
  const toast = useToast();
  const [refresh, setRefresh] = useState(0);
  const settings = useAsync(() => endpoints.admin.alertChannels(refresh > 0), [refresh]);
  const [busy, setBusy] = useState(false);

  async function save(change: () => Promise<AlertChannelSettings>, done: string) {
    setBusy(true);
    try {
      settings.setData(await change());
      toast(done, 'success');
      onChange?.();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const data = settings.data;

  return (
    <section className="mt-10" aria-labelledby="alert-channels">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="alert-channels">Discord alert channels</h2>
          <p className="mt-1 text-sm text-muted">
            Pick the channel that gets each world&apos;s alerts. Worlds without a choice use #{data?.prefix ?? 'wardens-'}&lt;world&gt;. The bot picks up changes within a minute.
          </p>
        </div>
        <button type="button" className="btn" disabled={settings.loading || busy} onClick={() => setRefresh((n) => n + 1)}>
          {settings.loading && data ? 'Reading Discord…' : 'Reload channels'}
        </button>
      </div>

      {settings.error && <p className="panel p-4 text-hp">{settings.error.message}</p>}
      {settings.loading && !data && <p className="text-muted">Reading the bot&apos;s Discord servers…</p>}
      {data && !data.enabled && <p className="panel p-4 text-sm text-muted">Set DISCORD_TOKEN for the backend to list the bot&apos;s Discord servers here.</p>}
      {data?.enabled && data.servers.length === 0 && <p className="panel p-4 text-sm text-muted">The bot is not on any Discord server yet.</p>}

      {data && (
        <div className="space-y-6">
          {data.servers.map((server) => (
            <ServerChannels
              key={server.id}
              server={server}
              settings={data}
              busy={busy}
              onSet={(world, channel) =>
                save(() => endpoints.admin.setAlertChannel(server.id, world, channel.id), `${world} alerts on ${server.name} now go to #${channel.name}.`)
              }
              onReset={(world) =>
                save(
                  () => endpoints.admin.resetAlertChannel(server.id, world),
                  `${world} alerts on ${server.name} go to #${data.prefix}${world.toLowerCase()} again.`,
                )
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

type ServerProps = {
  server: Server;
  settings: AlertChannelSettings;
  busy: boolean;
  onSet: (world: string, channel: DiscordChannel) => void;
  onReset: (world: string) => void;
};

/** One server: a row per world that has a channel (chosen or by name), and a row to add one. */
function ServerChannels({ server, settings, busy, onSet, onReset }: ServerProps) {
  const [newWorld, setNewWorld] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const chosen = new Map(settings.assignments.filter((a) => a.guild_id === server.id).map((a) => [a.server_name, a.channel_id]));
  const named = (world: string) => server.channels.find((c) => c.name.toLowerCase() === `${settings.prefix}${world.toLowerCase()}`);
  const rows = settings.worlds.filter((world) => chosen.has(world) || named(world));
  const others = settings.worlds.filter((world) => !rows.includes(world));
  const channelOf = (id: string) => server.channels.find((c) => c.id === id);

  function onPick(world: string, value: string) {
    if (value === '') {
      if (chosen.has(world)) onReset(world);
      return;
    }
    const channel = channelOf(value);
    if (channel) onSet(world, channel);
  }

  return (
    <div className="panel" role="group" aria-label={`Alert channels on ${server.name}`}>
      <h3 className="border-b-3 border-outline px-5 py-3">{server.name}</h3>
      {rows.length === 0 && <p className="px-5 py-4 text-sm text-muted">No world has an alert channel on this server yet.</p>}
      <ul>
        {rows.map((world) => {
          const current = chosen.get(world);
          const missing = current !== undefined && !channelOf(current);
          return (
            <li key={world} className="grid items-center gap-2 border-b-2 border-rule px-5 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <span className="font-semibold">{world}</span>
              <div className="min-w-0">
                <ChannelSelect
                  label={`Alert channel for ${world} on ${server.name}`}
                  channels={server.channels}
                  value={missing ? '' : (current ?? '')}
                  byName={named(world) ? `By name: #${named(world)!.name}` : `By name: #${settings.prefix}${world.toLowerCase()} (no such channel)`}
                  disabled={busy}
                  onChange={(value) => onPick(world, value)}
                />
                {missing && <p className="mt-1 text-sm text-hp">The chosen channel no longer exists: alerts for {world} are not posted on this server.</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 0 && server.channels.length > 0 && (
        <form
          className="grid gap-2 px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const channel = channelOf(newChannel);
            if (!newWorld || !channel) return;
            onSet(newWorld, channel);
            setNewWorld('');
            setNewChannel('');
          }}
        >
          <label>
            <span className="sr-only">World to add on {server.name}</span>
            <select className="input" value={newWorld} onChange={(e) => setNewWorld(e.target.value)} disabled={busy}>
              <option value="">Add a world…</option>
              {others.map((world) => (
                <option key={world} value={world}>
                  {world}
                </option>
              ))}
            </select>
          </label>
          <ChannelSelect
            label={`Channel for the new world on ${server.name}`}
            channels={server.channels}
            value={newChannel}
            byName="Pick a channel…"
            disabled={busy || !newWorld}
            onChange={setNewChannel}
          />
          <button type="submit" className="btn-primary" disabled={busy || !newWorld || !newChannel}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}

type SelectProps = {
  label: string;
  channels: DiscordChannel[];
  value: string;
  /** Text of the empty option. */
  byName: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

/** The server's text channels, grouped by category as in Discord. */
function ChannelSelect({ label, channels, value, byName, disabled, onChange }: SelectProps) {
  const groups: { category: string | null; channels: DiscordChannel[] }[] = [];
  for (const channel of channels) {
    const last = groups[groups.length - 1];
    if (last && last.category === channel.category) last.channels.push(channel);
    else groups.push({ category: channel.category, channels: [channel] });
  }
  const options = (list: DiscordChannel[]) =>
    list.map((c) => (
      <option key={c.id} value={c.id}>
        #{c.name}
      </option>
    ));

  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{byName}</option>
        {groups.map((group, i) =>
          group.category === null ? (
            <Fragment key={`none-${i}`}>{options(group.channels)}</Fragment>
          ) : (
            <optgroup key={`${group.category}-${i}`} label={group.category}>
              {options(group.channels)}
            </optgroup>
          ),
        )}
      </select>
    </label>
  );
}
