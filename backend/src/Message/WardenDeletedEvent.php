<?php

namespace App\Message;

/**
 * Published when an admin deletes a report (a false or duplicate one); tells the bot to
 * delete its alerts instead of letting them run out.
 */
final readonly class WardenDeletedEvent
{
    public function __construct(
        public string $spawnId,
        public string $serverName,
    ) {
    }
}
