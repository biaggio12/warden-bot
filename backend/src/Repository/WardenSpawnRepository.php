<?php

namespace App\Repository;

use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Enum\WardenSpawnStatus;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/**
 * @extends ServiceEntityRepository<WardenSpawn>
 */
class WardenSpawnRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, WardenSpawn::class);
    }

    public function findByIdString(string $id): ?WardenSpawn
    {
        if (!Uuid::isValid($id)) {
            return null;
        }

        return $this->find(Uuid::fromString($id));
    }

    /**
     * @return list<WardenSpawn>
     */
    public function findActive(?string $serverName, \DateTimeImmutable $now): array
    {
        $qb = $this->createQueryBuilder('s')
            ->addSelect('m')
            ->join('s.monster', 'm')
            ->where('s.status = :status')
            ->andWhere('s.expiresAt > :now')
            ->setParameter('status', WardenSpawnStatus::Active)
            ->setParameter('now', $now)
            ->orderBy('s.expiresAt', 'ASC');

        if (null !== $serverName) {
            $qb->andWhere('s.serverName = :server')->setParameter('server', $serverName);
        }

        return $qb->getQuery()->getResult();
    }

    /**
     * When the player's reports since `$since` were made, oldest first (for the report limit).
     *
     * @return list<\DateTimeImmutable>
     */
    public function reportTimesSince(User $reporter, \DateTimeImmutable $since): array
    {
        $rows = $this->createQueryBuilder('s')
            ->select('s.createdAt')
            ->where('s.reportedBy = :reporter')
            ->andWhere('s.createdAt > :since')
            ->setParameter('reporter', $reporter)
            ->setParameter('since', $since)
            ->orderBy('s.createdAt', 'ASC')
            ->getQuery()
            ->getArrayResult();

        return array_map(static fn (array $row): \DateTimeImmutable => $row['createdAt'], $rows);
    }

    /**
     * Flips every overdue ACTIVE spawn to EXPIRED in a single UPDATE and returns what changed.
     * UPDATE ... RETURNING keeps it atomic, so two workers can never expire the same row twice.
     *
     * @return list<array{id: string, monster_id: int, server_name: string, expires_at: string}>
     */
    public function expireOverdue(\DateTimeImmutable $now): array
    {
        $rows = $this->getEntityManager()->getConnection()->fetchAllAssociative(
            'UPDATE warden_spawns SET status = :expired
             WHERE status = :active AND expires_at < :now
             RETURNING id, monster_id, server_name, expires_at',
            [
                'expired' => WardenSpawnStatus::Expired->value,
                'active' => WardenSpawnStatus::Active->value,
                'now' => $now->format('Y-m-d H:i:s'),
            ],
        );

        return array_map(static fn (array $row): array => [
            'id' => (string) $row['id'],
            'monster_id' => (int) $row['monster_id'],
            'server_name' => (string) $row['server_name'],
            'expires_at' => (string) $row['expires_at'],
        ], $rows);
    }
}
