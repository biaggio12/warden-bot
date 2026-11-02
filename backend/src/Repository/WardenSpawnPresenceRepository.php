<?php

namespace App\Repository;

use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<WardenSpawnPresence>
 */
class WardenSpawnPresenceRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, WardenSpawnPresence::class);
    }

    public function findOneByAlert(WardenSpawn $spawn, string $messageId): ?WardenSpawnPresence
    {
        return $this->findOneBy(['spawn' => $spawn, 'messageId' => $messageId]);
    }
}
