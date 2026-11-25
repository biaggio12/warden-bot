<?php

namespace App\Message;

/**
 * Published when an admin posts the maintenance notice from the website, before a new
 * version is deployed: the bot tells every alert channel it is down for a moment.
 */
final readonly class BotMaintenanceEvent
{
    public function __construct(
        /** When the bot should be back; null when the admin did not say. */
        public ?\DateTimeImmutable $backAt,
        /** The admin's own words for the players, if any. */
        public ?string $note,
        /** Display name of the admin, for the bot's log. */
        public string $requestedBy,
    ) {
    }
}
