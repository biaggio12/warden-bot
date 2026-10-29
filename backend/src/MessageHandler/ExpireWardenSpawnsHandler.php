<?php

namespace App\MessageHandler;

use App\Message\ExpireWardenSpawns;
use App\Message\WardenExpiredEvent;
use App\Repository\WardenSpawnRepository;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsMessageHandler]
final readonly class ExpireWardenSpawnsHandler
{
    public function __construct(
        private WardenSpawnRepository $spawns,
        private MessageBusInterface $bus,
        private ClockInterface $clock,
        private LoggerInterface $logger,
    ) {
    }

    /**
     * @return int number of spawns expired
     */
    public function __invoke(ExpireWardenSpawns $message): int
    {
        $expired = $this->spawns->expireOverdue($this->clock->now());

        foreach ($expired as $row) {
            $this->bus->dispatch(new WardenExpiredEvent(
                spawnId: $row['id'],
                monsterId: $row['monster_id'],
                serverName: $row['server_name'],
                expiresAt: new \DateTimeImmutable($row['expires_at'], new \DateTimeZone('UTC')),
            ));
        }

        if ([] !== $expired) {
            $this->logger->info('Expired {count} Warden spawn(s).', ['count' => \count($expired)]);
        }

        return \count($expired);
    }
}
