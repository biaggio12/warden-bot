<?php

namespace App\Dto;

use App\Entity\Duel;
use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

/** A challenge: who reports more Wardens in the next `minutes`. */
final readonly class CreateDuelRequest
{
    public function __construct(
        /** The opponent's Discord account (the bot's /duel picks a member). */
        #[Assert\NotBlank]
        #[Assert\Regex('/^\d{5,20}$/', message: 'Pick a Discord member.')]
        #[SerializedName('opponent_discord_user_id')]
        public ?string $opponentDiscordUserId = null,
        #[Assert\NotNull]
        #[Assert\Choice(choices: Duel::DURATIONS, message: 'A duel lasts 15, 30, 60, 120 or 180 minutes.')]
        public ?int $minutes = null,
        /** Points the winner takes from the loser; 0 plays just for glory. */
        #[Assert\Range(min: 0, max: Duel::MAX_STAKE)]
        public int $stake = 0,
        /** The channel the challenge is posted in; the result goes there too. */
        #[Assert\Regex('/^\d{5,20}$/')]
        #[SerializedName('discord_channel_id')]
        public ?string $discordChannelId = null,
    ) {
    }
}
