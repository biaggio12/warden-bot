<?php

namespace App\Message;

use App\Entity\Duel;
use App\Service\StatsService;

/**
 * Published when a duel's scores are in; the bot posts the result where the challenge was.
 */
final readonly class DuelFinishedEvent
{
    public function __construct(
        public string $duelId,
        public int $minutes,
        /** Points the winner took from the loser (none on a draw). */
        public int $stake,
        public ?string $challengerDiscordUserId,
        public string $challengerName,
        public int $challengerScore,
        public ?string $opponentDiscordUserId,
        public string $opponentName,
        public int $opponentScore,
        /** challenger, opponent or draw */
        public string $result,
        public ?string $discordChannelId,
        public ?string $discordMessageId,
    ) {
    }

    public static function fromDuel(Duel $duel): self
    {
        $challenger = $duel->getChallenger();
        $opponent = $duel->getOpponent();
        $winner = $duel->getWinner();

        return new self(
            duelId: $duel->getId()->toRfc4122(),
            minutes: $duel->getDurationMinutes(),
            stake: $duel->getStake(),
            challengerDiscordUserId: $challenger->getDiscordUserId(),
            challengerName: StatsService::publicName($challenger->getDiscordUsername(), $challenger->getEmail()),
            challengerScore: (int) $duel->getChallengerScore(),
            opponentDiscordUserId: $opponent->getDiscordUserId(),
            opponentName: StatsService::publicName($opponent->getDiscordUsername(), $opponent->getEmail()),
            opponentScore: (int) $duel->getOpponentScore(),
            result: null === $winner ? 'draw' : ($winner === $challenger ? 'challenger' : 'opponent'),
            discordChannelId: $duel->getDiscordChannelId(),
            discordMessageId: $duel->getDiscordMessageId(),
        );
    }
}
