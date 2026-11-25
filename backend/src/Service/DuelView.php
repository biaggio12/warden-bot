<?php

namespace App\Service;

use App\Entity\Duel;
use App\Entity\User;
use App\Enum\DuelStatus;
use App\Http\Json;
use Psr\Clock\ClockInterface;

/**
 * The API shape of a duel. While a duel runs the scores are counted live (so far);
 * a confirmation may still come in, so they can grow until the result is in.
 */
final readonly class DuelView
{
    public function __construct(
        private ReportScoring $scoring,
        private ClockInterface $clock,
        private PlayerNames $names,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function of(Duel $duel, ?User $viewer = null): array
    {
        [$challengerScore, $opponentScore] = $this->scores($duel);
        $winner = $duel->getWinner();
        $names = $this->names->of([(int) $duel->getChallenger()->getId(), (int) $duel->getOpponent()->getId()]);

        return [
            'id' => $duel->getId()->toRfc4122(),
            'status' => strtolower($duel->getStatus()->value),
            'minutes' => $duel->getDurationMinutes(),
            'stake' => $duel->getStake(),
            'created_at' => Json::date($duel->getCreatedAt()),
            'accept_by' => Json::date($duel->getAcceptBy()),
            'starts_at' => null === $duel->getStartsAt() ? null : Json::date($duel->getStartsAt()),
            'ends_at' => null === $duel->getEndsAt() ? null : Json::date($duel->getEndsAt()),
            'scored_at' => null === $duel->getScoredAt() ? null : Json::date($duel->getScoredAt()),
            'challenger' => self::player($duel->getChallenger(), $names[(int) $duel->getChallenger()->getId()], $challengerScore, $viewer),
            'opponent' => self::player($duel->getOpponent(), $names[(int) $duel->getOpponent()->getId()], $opponentScore, $viewer),
            'result' => match (true) {
                DuelStatus::Finished !== $duel->getStatus() => null,
                null === $winner => 'draw',
                $winner === $duel->getChallenger() => 'challenger',
                default => 'opponent',
            },
            'discord_channel_id' => $duel->getDiscordChannelId(),
            'discord_message_id' => $duel->getDiscordMessageId(),
        ];
    }

    /**
     * @return array{0: ?int, 1: ?int}
     */
    private function scores(Duel $duel): array
    {
        if (DuelStatus::Finished === $duel->getStatus()) {
            return [$duel->getChallengerScore(), $duel->getOpponentScore()];
        }
        if (DuelStatus::Active !== $duel->getStatus()) {
            return [null, null];
        }
        // Times are stored in whole seconds: include a report made this very second.
        $until = min($this->clock->now()->modify('+1 second'), $duel->getEndsAt());

        return $this->count($duel, $until);
    }

    /**
     * Counted reports of both players between the start and `$until`.
     *
     * @return array{0: int, 1: int}
     */
    public function count(Duel $duel, ?\DateTimeImmutable $until = null): array
    {
        $challengerId = (int) $duel->getChallenger()->getId();
        $opponentId = (int) $duel->getOpponent()->getId();
        $points = $this->scoring->pointsBetween(
            $duel->getStartsAt() ?? throw new \LogicException('The duel has not started.'),
            $until ?? $duel->getEndsAt(),
            [$challengerId, $opponentId],
        );

        return [$points[$challengerId] ?? 0, $points[$opponentId] ?? 0];
    }

    /**
     * @return array{name: string, discord_user_id: ?string, score: ?int, is_you: bool}
     */
    private static function player(User $user, string $name, ?int $score, ?User $viewer): array
    {
        return [
            'name' => $name,
            'discord_user_id' => $user->getDiscordUserId(),
            'score' => $score,
            'is_you' => null !== $viewer && $viewer->getId() === $user->getId(),
        ];
    }
}
