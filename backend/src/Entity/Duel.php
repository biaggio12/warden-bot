<?php

namespace App\Entity;

use App\Enum\DuelStatus;
use App\Repository\DuelRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * Two players race: who scores more points for Wardens in the agreed time. Only reports that
 * earn points count, weighted by difficulty (see ReportScoring), so fake reports do not help.
 */
#[ORM\Entity(repositoryClass: DuelRepository::class)]
#[ORM\Table(name: 'duels')]
#[ORM\Index(name: 'idx_duels_status_ends_at', columns: ['status', 'ends_at'])]
class Duel
{
    /** Durations a duel may last, in minutes. */
    public const DURATIONS = [15, 30, 60, 120, 180];
    /** A challenge nobody accepts in this time expires. */
    public const ACCEPT_MINUTES = 10;
    /**
     * At the end the result comes at once, unless a player's report from the duel is still
     * up: then once it is closed ([Dead] or expired), at most this long after the end (a
     * Warden lasts at most 10 minutes).
     */
    public const SCORING_GRACE_MINUTES = WardenSpawn::MAX_TTL_MINUTES;
    /** The most points a duel can be played for. */
    public const MAX_STAKE = 1000;

    #[ORM\Id]
    #[ORM\Column(type: 'uuid', unique: true)]
    private Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $challenger;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $opponent;

    #[ORM\Column]
    private int $durationMinutes;

    /** Points the winner takes from the loser (0: just for glory). */
    #[ORM\Column(options: ['default' => 0])]
    private int $stake;

    #[ORM\Column(length: 10, enumType: DuelStatus::class)]
    private DuelStatus $status = DuelStatus::Pending;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $acceptBy;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $startsAt = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $endsAt = null;

    #[ORM\Column(nullable: true)]
    private ?int $challengerScore = null;

    #[ORM\Column(nullable: true)]
    private ?int $opponentScore = null;

    /** Where the challenge was posted; the result is posted there too. */
    #[ORM\Column(length: 20, nullable: true)]
    private ?string $discordChannelId;

    #[ORM\Column(length: 20, nullable: true)]
    private ?string $discordMessageId = null;

    public function __construct(
        User $challenger,
        User $opponent,
        int $durationMinutes,
        \DateTimeImmutable $now,
        ?string $discordChannelId = null,
        int $stake = 0,
    ) {
        if ($stake < 0 || $stake > self::MAX_STAKE) {
            throw new \InvalidArgumentException('Unsupported stake.');
        }
        $this->stake = $stake;
        if ($challenger === $opponent) {
            throw new \InvalidArgumentException('A player cannot duel themselves.');
        }
        if (!\in_array($durationMinutes, self::DURATIONS, true)) {
            throw new \InvalidArgumentException('Unsupported duel duration.');
        }
        $this->id = Uuid::v7();
        $this->challenger = $challenger;
        $this->opponent = $opponent;
        $this->durationMinutes = $durationMinutes;
        $this->createdAt = $now->setMicrosecond(0);
        $this->acceptBy = $this->createdAt->modify(\sprintf('+%d minutes', self::ACCEPT_MINUTES));
        $this->discordChannelId = $discordChannelId;
    }

    public function getId(): Uuid
    {
        return $this->id;
    }

    public function getChallenger(): User
    {
        return $this->challenger;
    }

    public function getOpponent(): User
    {
        return $this->opponent;
    }

    public function involves(User $user): bool
    {
        return $this->isChallenger($user) || $this->isOpponent($user);
    }

    public function isChallenger(User $user): bool
    {
        return null !== $user->getId() && $this->challenger->getId() === $user->getId();
    }

    public function isOpponent(User $user): bool
    {
        return null !== $user->getId() && $this->opponent->getId() === $user->getId();
    }

    public function getDurationMinutes(): int
    {
        return $this->durationMinutes;
    }

    public function getStake(): int
    {
        return $this->stake;
    }

    public function getStatus(): DuelStatus
    {
        return $this->status;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getAcceptBy(): \DateTimeImmutable
    {
        return $this->acceptBy;
    }

    public function getStartsAt(): ?\DateTimeImmutable
    {
        return $this->startsAt;
    }

    public function getEndsAt(): ?\DateTimeImmutable
    {
        return $this->endsAt;
    }

    /** The latest the scores are counted: the end plus the grace for reports still up. */
    public function getScoredAt(): ?\DateTimeImmutable
    {
        return $this->endsAt?->modify(\sprintf('+%d minutes', self::SCORING_GRACE_MINUTES));
    }

    public function getChallengerScore(): ?int
    {
        return $this->challengerScore;
    }

    public function getOpponentScore(): ?int
    {
        return $this->opponentScore;
    }

    /** null while open and on a draw. */
    public function getWinner(): ?User
    {
        if (DuelStatus::Finished !== $this->status || $this->challengerScore === $this->opponentScore) {
            return null;
        }

        return $this->challengerScore > $this->opponentScore ? $this->challenger : $this->opponent;
    }

    public function getDiscordChannelId(): ?string
    {
        return $this->discordChannelId;
    }

    public function getDiscordMessageId(): ?string
    {
        return $this->discordMessageId;
    }

    /** The bot tells which message shows the challenge, so it can update it later. */
    public function attachDiscordMessage(string $channelId, string $messageId): void
    {
        $this->discordChannelId = $channelId;
        $this->discordMessageId = $messageId;
    }

    public function canBeAcceptedAt(\DateTimeImmutable $now): bool
    {
        return DuelStatus::Pending === $this->status && $now < $this->acceptBy;
    }

    public function accept(\DateTimeImmutable $now): void
    {
        if (!$this->canBeAcceptedAt($now)) {
            throw new \LogicException('This challenge can no longer be accepted.');
        }
        $this->status = DuelStatus::Active;
        $this->startsAt = $now->setMicrosecond(0);
        $this->endsAt = $this->startsAt->modify(\sprintf('+%d minutes', $this->durationMinutes));
    }

    public function decline(): void
    {
        if (DuelStatus::Pending !== $this->status) {
            throw new \LogicException('Only a pending challenge can be declined.');
        }
        $this->status = DuelStatus::Declined;
    }

    public function expire(): void
    {
        if (DuelStatus::Pending !== $this->status) {
            throw new \LogicException('Only a pending challenge can expire.');
        }
        $this->status = DuelStatus::Expired;
    }

    public function finish(int $challengerScore, int $opponentScore): void
    {
        if (DuelStatus::Active !== $this->status) {
            throw new \LogicException('Only an active duel can finish.');
        }
        $this->status = DuelStatus::Finished;
        $this->challengerScore = $challengerScore;
        $this->opponentScore = $opponentScore;
    }
}
