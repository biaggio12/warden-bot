<?php

namespace App\Message;

use App\Entity\WardenSpawn;

/**
 * Published to the `warden_events` exchange when a player reports a Warden.
 * Consumed by the Discord bot; the JSON shape is defined in JsonEventSerializer.
 */
final readonly class WardenSpawnedEvent
{
    public function __construct(
        public string $spawnId,
        public int $monsterId,
        public string $monsterName,
        public string $monsterCategory,
        public ?string $monsterImageUrl,
        public string $serverName,
        public string $locationDescription,
        public ?string $city,
        public ?string $additionalInfo,
        public string $reportedByDiscordUserId,
        /** @var list<string> the reporter's characters on that world */
        public array $reportedByCharacters,
        public ?string $reportedByName,
        /** Post the alert in this Discord server only; null = decided by the bot. */
        public ?string $discordGuildId,
        public \DateTimeImmutable $createdAt,
        public \DateTimeImmutable $expiresAt,
    ) {
    }

    /**
     * @param array{characters: list<string>, discord_name: ?string} $reportedBy see ReporterInfo
     */
    public static function fromSpawn(WardenSpawn $spawn, array $reportedBy): self
    {
        $monster = $spawn->getMonster();

        return new self(
            spawnId: $spawn->getId()->toRfc4122(),
            monsterId: (int) $monster->getId(),
            monsterName: $monster->getName(),
            monsterCategory: $monster->getCategory(),
            monsterImageUrl: $monster->getImageUrl(),
            serverName: $spawn->getServerName(),
            locationDescription: $spawn->getLocationDescription(),
            city: $spawn->getCity(),
            additionalInfo: $spawn->getAdditionalInfo(),
            reportedByDiscordUserId: (string) $spawn->getReportedBy()?->getDiscordUserId(),
            reportedByCharacters: $reportedBy['characters'],
            reportedByName: $reportedBy['discord_name'],
            discordGuildId: $spawn->getDiscordGuildId(),
            createdAt: $spawn->getCreatedAt(),
            expiresAt: $spawn->getExpiresAt(),
        );
    }
}
