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

    /** Whether a player clicked [No Need] on any of the report's alerts (stored in on_site). */
    public function anyNoNeed(WardenSpawn $spawn): bool
    {
        foreach ($this->findBy(['spawn' => $spawn]) as $presence) {
            if ([] !== $presence->getOnSite()) {
                return true;
            }
        }

        return false;
    }
}
