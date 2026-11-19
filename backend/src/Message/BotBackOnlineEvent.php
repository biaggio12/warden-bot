<?php

namespace App\Message;

/**
 * Published when an admin posts on the website that the deploy is over: the bot tells
 * every alert channel it works again.
 */
final readonly class BotBackOnlineEvent
{
    public function __construct(
        /** The admin's own words for the players (e.g. what is new), if any. */
        public ?string $note,
        /** Display name of the admin, for the bot's log. */
        public string $requestedBy,
    ) {
    }
}
