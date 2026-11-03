<?php

namespace App\Service;

use App\Repository\AlertChannelRepository;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\HttpExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * The Discord servers a web report can be sent to: servers the bot is in, the player is a
 * member of, and that have an alert channel for the world: the one an admin assigned
 * (AlertChannel), else the one named <prefix><world>. Read from the Discord API with the
 * bot token; disabled (empty list) while DISCORD_TOKEN is empty.
 */
final readonly class DiscordGuildDirectory
{
    private const GUILD_TEXT = 0;
    private const GUILD_CATEGORY = 4;
    private const TTL_SECONDS = 300;

    public function __construct(
        #[Autowire(service: 'discord.client')]
        private HttpClientInterface $discord,
        private CacheInterface $cache,
        private LoggerInterface $logger,
        #[Autowire('%env(default::DISCORD_TOKEN)%')]
        private ?string $botToken,
        #[Autowire('%env(default::CHANNEL_PREFIX)%')]
        private ?string $channelPrefix,
        private AlertChannelRepository $assignments,
    ) {
    }

    public function isEnabled(): bool
    {
        return '' !== $this->token();
    }

    /**
     * @return list<array{id: string, name: string}> sorted by name
     */
    public function guildsFor(string $discordUserId, string $world): array
    {
        if (!$this->isEnabled()) {
            return [];
        }

        try {
            $guilds = array_values(array_filter(
                $this->botGuilds(),
                fn (array $guild): bool => null !== $this->alertChannelOf($guild['id'], $world)
                    && $this->isMember($guild['id'], $discordUserId),
            ));
        } catch (ExceptionInterface $e) {
            $this->logger->warning('Could not list Discord servers: {error}', ['error' => $e->getMessage()]);

            return [];
        }
        usort($guilds, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

        return $guilds;
    }

    /**
     * Whether the player may send a report to this server. Unknown when Discord cannot be
     * reached (null): the caller lets the report through, the bot checks the channel anyway.
     */
    public function isMember(string $guildId, string $discordUserId): ?bool
    {
        if (!$this->isEnabled()) {
            return null;
        }

        try {
            return $this->cache->get("discord.member.$guildId.$discordUserId", function (ItemInterface $item) use ($guildId, $discordUserId): bool {
                $item->expiresAfter(self::TTL_SECONDS);
                try {
                    $this->request("guilds/$guildId/members/$discordUserId");

                    return true;
                } catch (HttpExceptionInterface $e) {
                    // 404: not a member (or no such server); 403: the bot is not in it.
                    if (\in_array($e->getResponse()->getStatusCode(), [403, 404], true)) {
                        return false;
                    }
                    throw $e;
                }
            });
        } catch (ExceptionInterface $e) {
            $this->logger->warning('Could not check Discord membership: {error}', ['error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * Every server the bot is in with its text channels, for the admin's channel picker.
     * `$refresh` reads Discord again instead of the copy cached for a few minutes.
     *
     * @return list<array{id: string, name: string, channels: list<array{id: string, name: string, category: ?string}>}>
     */
    public function serversWithChannels(bool $refresh = false): array
    {
        if ($refresh) {
            $this->cache->delete('discord.bot_guilds');
        }
        $servers = [];
        foreach ($this->botGuilds() as $guild) {
            if ($refresh) {
                $this->cache->delete("discord.guild_text_channels.{$guild['id']}");
            }
            $servers[] = $guild + ['channels' => $this->textChannels($guild['id'])];
        }
        usort($servers, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

        return $servers;
    }

    /**
     * The text channel of this server that gets the world's alerts, or null when none.
     *
     * @return array{id: string, name: string, category: ?string}|null
     */
    public function alertChannelOf(string $guildId, string $world): ?array
    {
        $channels = $this->textChannels($guildId);
        $assigned = $this->assignments->findOneByGuildAndWorld($guildId, $world);
        if (null !== $assigned) {
            foreach ($channels as $channel) {
                if ($channel['id'] === $assigned->getChannelId()) {
                    return $channel;
                }
            }

            return null;
        }
        $name = strtolower($this->prefix().$world);
        foreach ($channels as $channel) {
            if (strtolower($channel['name']) === $name) {
                return $channel;
            }
        }

        return null;
    }

    public function prefix(): string
    {
        return $this->channelPrefix ?? 'wardens-';
    }

    /** @return list<array{id: string, name: string}> */
    private function botGuilds(): array
    {
        return $this->cache->get('discord.bot_guilds', function (ItemInterface $item): array {
            $item->expiresAfter(self::TTL_SECONDS);

            return array_map(
                static fn (array $guild): array => ['id' => (string) $guild['id'], 'name' => (string) $guild['name']],
                $this->request('users/@me/guilds'),
            );
        });
    }

    /** @return list<array{id: string, name: string, category: ?string}> the server's text channels, in Discord's order */
    private function textChannels(string $guildId): array
    {
        return $this->cache->get("discord.guild_text_channels.$guildId", function (ItemInterface $item) use ($guildId): array {
            $item->expiresAfter(self::TTL_SECONDS);
            $all = $this->request("guilds/$guildId/channels");
            $categories = [];
            foreach ($all as $c) {
                if (self::GUILD_CATEGORY === ($c['type'] ?? null)) {
                    $categories[(string) $c['id']] = ['name' => (string) $c['name'], 'position' => (int) ($c['position'] ?? 0)];
                }
            }
            $channels = array_values(array_filter($all, static fn (array $c): bool => self::GUILD_TEXT === ($c['type'] ?? null)));
            // Discord's sidebar order: channels outside a category first, then by category.
            $order = static fn (array $c): array => [
                null === ($c['parent_id'] ?? null) ? -1 : ($categories[(string) $c['parent_id']]['position'] ?? 0),
                (int) ($c['position'] ?? 0),
            ];
            usort($channels, static fn (array $a, array $b): int => $order($a) <=> $order($b));

            return array_map(static fn (array $c): array => [
                'id' => (string) ($c['id'] ?? ''),
                'name' => (string) $c['name'],
                'category' => $categories[(string) ($c['parent_id'] ?? '')]['name'] ?? null,
            ], $channels);
        });
    }

    /** @return array<mixed> */
    private function request(string $path): array
    {
        return $this->discord->request('GET', $path, ['headers' => ['Authorization' => 'Bot '.$this->token()]])->toArray();
    }

    private function token(): string
    {
        return (string) preg_replace('/^Bot\s+/i', '', trim((string) $this->botToken));
    }
}
