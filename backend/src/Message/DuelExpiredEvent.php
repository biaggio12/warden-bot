<?php

namespace App\Message;

use App\Entity\Duel;

/**
 * Published when nobody accepted a challenge in time; the bot takes the buttons off it.
 */
final readonly class DuelExpiredEvent
{
    public function __construct(
        public string $duelId,
        public ?string $challengerDiscordUserId,
        public ?string $opponentDiscordUserId,
        public ?string $discordChannelId,
        public ?string $discordMessageId,
    ) {
    }

    public static function fromDuel(Duel $duel): self
    {
        return new self(
            duelId: $duel->getId()->toRfc4122(),
            challengerDiscordUserId: $duel->getChallenger()->getDiscordUserId(),
            opponentDiscordUserId: $duel->getOpponent()->getDiscordUserId(),
            discordChannelId: $duel->getDiscordChannelId(),
            discordMessageId: $duel->getDiscordMessageId(),
        );
    }
}
