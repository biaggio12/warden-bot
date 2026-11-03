<?php

namespace App\Entity;

use App\Repository\AlertChannelRepository;
use Doctrine\ORM\Mapping as ORM;

/**
 * The Discord channel that gets the alerts of one world on one server, chosen by an admin
 * in the Players tab. Kept by id, so the channel can have any name. A server without an
 * entry for a world falls back to the channel named <prefix><world>.
 */
#[ORM\Entity(repositoryClass: AlertChannelRepository::class)]
#[ORM\Table(name: 'alert_channels')]
#[ORM\UniqueConstraint(name: 'uniq_alert_channels_channel', columns: ['channel_id'])]
class AlertChannel
{
    public function __construct(
        #[ORM\Id]
        #[ORM\Column(length: 20)]
        private string $guildId,
        #[ORM\Id]
        #[ORM\Column(length: 64)]
        private string $serverName,
        #[ORM\Column(length: 20)]
        private string $channelId,
        #[ORM\Column]
        private \DateTimeImmutable $updatedAt,
    ) {
    }

    public function getGuildId(): string
    {
        return $this->guildId;
    }

    public function getServerName(): string
    {
        return $this->serverName;
    }

    public function getChannelId(): string
    {
        return $this->channelId;
    }

    public function changeChannel(string $channelId, \DateTimeImmutable $now): void
    {
        $this->channelId = $channelId;
        $this->updatedAt = $now;
    }

    /** @return array{guild_id: string, server_name: string, channel_id: string} */
    public function toArray(): array
    {
        return ['guild_id' => $this->guildId, 'server_name' => $this->serverName, 'channel_id' => $this->channelId];
    }
}
