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

    /**
     * Whether the reporter clicked [No Need] on any of the report's alerts (stored in
     * on_site): they hand [Dead] over to everyone.
     */
    public function reporterSaidNoNeed(WardenSpawn $spawn): bool
    {
        $discordUserId = $spawn->getReportedBy()?->getDiscordUserId();
        if (null === $discordUserId) {
            return false;
        }
        foreach ($this->findBy(['spawn' => $spawn]) as $presence) {
            if (\in_array($discordUserId, $presence->getOnSite(), true)) {
                return true;
            }
        }

        return false;
    }
}
