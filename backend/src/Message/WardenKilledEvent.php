<?php

namespace App\Message;

use App\Entity\User;
use App\Entity\WardenSpawn;

/**
 * Published when a player closes a report early because the Warden is dead;
 * tells the bot to take the alert down.
 */
final readonly class WardenKilledEvent
{
    public function __construct(
        public string $spawnId,
        public int $monsterId,
        public string $serverName,
        public string $killedByDiscordUserId,
        /** Discord username only: the e-mail behind an account is never published. */
        public ?string $killedByName,
    ) {
    }

    public static function fromSpawn(WardenSpawn $spawn, User $by): self
    {
        return new self(
            spawnId: $spawn->getId()->toRfc4122(),
            monsterId: (int) $spawn->getMonster()->getId(),
            serverName: $spawn->getServerName(),
            killedByDiscordUserId: (string) $by->getDiscordUserId(),
            killedByName: $by->getDiscordUsername(),
        );
    }
}
