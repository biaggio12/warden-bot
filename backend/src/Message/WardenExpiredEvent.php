<?php

namespace App\Message;

/**
 * Published when the TTL scheduler closes a spawn; tells the bot to disable its buttons.
 */
final readonly class WardenExpiredEvent
{
    public function __construct(
        public string $spawnId,
        public int $monsterId,
        public string $serverName,
        public \DateTimeImmutable $expiresAt,
    ) {
    }
}
