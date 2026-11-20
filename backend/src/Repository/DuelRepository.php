<?php

namespace App\Repository;

use App\Entity\Duel;
use App\Entity\User;
use App\Enum\DuelStatus;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/**
 * @extends ServiceEntityRepository<Duel>
 */
class DuelRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Duel::class);
    }

    public function findByIdString(string $id): ?Duel
    {
        return Uuid::isValid($id) ? $this->find(Uuid::fromString($id)) : null;
    }

    /**
     * The player's challenge waiting for an answer or duel in progress, if any (a player
     * is in at most one at a time). A challenge past its deadline no longer counts.
     */
    public function findOpenOf(User $user, \DateTimeImmutable $now): ?Duel
    {
        return $this->createQueryBuilder('d')
            ->where('d.challenger = :user OR d.opponent = :user')
            ->andWhere('(d.status = :pending AND d.acceptBy > :now) OR d.status = :active')
            ->setParameter('user', $user)
            ->setParameter('pending', DuelStatus::Pending)
            ->setParameter('active', DuelStatus::Active)
            ->setParameter('now', $now)
            ->orderBy('d.createdAt', 'DESC')
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /**
     * @return list<Duel> the player's duels, newest first
     */
    public function recentOf(User $user, int $limit = 10): array
    {
        return $this->createQueryBuilder('d')
            ->addSelect('c', 'o')
            ->join('d.challenger', 'c')
            ->join('d.opponent', 'o')
            ->where('d.challenger = :user OR d.opponent = :user')
            ->setParameter('user', $user)
            ->orderBy('d.createdAt', 'DESC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    /** @return list<Duel> challenges nobody accepted in time */
    public function findPendingPastDeadline(\DateTimeImmutable $now): array
    {
        return $this->createQueryBuilder('d')
            ->where('d.status = :pending AND d.acceptBy <= :now')
            ->setParameter('pending', DuelStatus::Pending)
            ->setParameter('now', $now)
            ->getQuery()
            ->getResult();
    }

    /**
     * Active duels whose time is up and whose result is final: neither player still has a
     * report from the duel that is up (it may yet be confirmed with [Dead]), or the scoring
     * grace is over anyway.
     *
     * @return list<Duel>
     */
    public function findReadyToScore(\DateTimeImmutable $now): array
    {
        $ids = $this->getEntityManager()->getConnection()->fetchFirstColumn(
            "SELECT d.id FROM duels d
             WHERE d.status = 'ACTIVE' AND d.ends_at <= :now
               AND (
                   d.ends_at <= :grace_cutoff
                   OR NOT EXISTS (
                       SELECT 1 FROM warden_spawns s
                       WHERE s.reported_by_user_id IN (d.challenger_id, d.opponent_id)
                         AND s.created_at >= d.starts_at AND s.created_at < d.ends_at
                         AND s.status = 'ACTIVE' AND s.expires_at > :now
                   )
               )",
            [
                'now' => $now->format('Y-m-d H:i:s'),
                'grace_cutoff' => $now->modify(\sprintf('-%d minutes', Duel::SCORING_GRACE_MINUTES))->format('Y-m-d H:i:s'),
            ],
        );

        return array_values(array_filter(array_map(fn (string $id): ?Duel => $this->find(Uuid::fromString($id)), $ids)));
    }

    /**
     * Won / lost / drawn duels of the player, all time.
     *
     * @return array{won: int, lost: int, drawn: int}
     */
    public function recordOf(User $user): array
    {
        $row = $this->getEntityManager()->getConnection()->fetchAssociative(
            "SELECT
                COUNT(*) FILTER (WHERE (challenger_id = :u AND challenger_score > opponent_score) OR (opponent_id = :u AND opponent_score > challenger_score)) AS won,
                COUNT(*) FILTER (WHERE (challenger_id = :u AND challenger_score < opponent_score) OR (opponent_id = :u AND opponent_score < challenger_score)) AS lost,
                COUNT(*) FILTER (WHERE challenger_score = opponent_score) AS drawn
             FROM duels WHERE status = 'FINISHED' AND (challenger_id = :u OR opponent_id = :u)",
            ['u' => $user->getId()],
        );

        return ['won' => (int) ($row['won'] ?? 0), 'lost' => (int) ($row['lost'] ?? 0), 'drawn' => (int) ($row['drawn'] ?? 0)];
    }
}
