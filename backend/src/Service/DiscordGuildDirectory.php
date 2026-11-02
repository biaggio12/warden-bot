<?php

namespace App\Service;

use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\HttpExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * The Discord servers a web report can be sent to: servers the bot is in, the player is a
 * member of, and that have the alert channel of the world (<prefix><world>). Read from the
 * Discord API with the bot token; disabled (empty list) while DISCORD_TOKEN is empty.
 */
final readonly class DiscordGuildDirectory
{
    private const GUILD_TEXT = 0;
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
            $channel = strtolower($this->prefix().$world);
            $guilds = array_values(array_filter(
                $this->botGuilds(),
                fn (array $guild): bool => \in_array($channel, $this->textChannels($guild['id']), true)
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

    /** @return list<string> lowercase names of the server's text channels */
    private function textChannels(string $guildId): array
    {
        return $this->cache->get("discord.guild_channels.$guildId", function (ItemInterface $item) use ($guildId): array {
            $item->expiresAfter(self::TTL_SECONDS);
            $channels = array_filter($this->request("guilds/$guildId/channels"), static fn (array $c): bool => self::GUILD_TEXT === ($c['type'] ?? null));

            return array_values(array_map(static fn (array $c): string => strtolower((string) $c['name']), $channels));
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

    /** Same default as the bot's CHANNEL_PREFIX. */
    private function prefix(): string
    {
        return $this->channelPrefix ?? 'wardens-';
    }
}
