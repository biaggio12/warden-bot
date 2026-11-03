<?php

namespace App\Repository;

use App\Entity\AlertChannel;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<AlertChannel>
 */
class AlertChannelRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, AlertChannel::class);
    }

    /** @return list<AlertChannel> by server, then world */
    public function all(): array
    {
        return $this->findBy([], ['guildId' => 'ASC', 'serverName' => 'ASC']);
    }

    public function findOneByGuildAndWorld(string $guildId, string $serverName): ?AlertChannel
    {
        return $this->find(['guildId' => $guildId, 'serverName' => $serverName]);
    }

    public function findOneByChannel(string $channelId): ?AlertChannel
    {
        return $this->findOneBy(['channelId' => $channelId]);
    }
}
