<?php

namespace App\Tests\Integration;

use App\Entity\Monster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Enum\WardenSpawnStatus;
use App\Message\ExpireWardenSpawns;
use App\Message\WardenExpiredEvent;
use App\MessageHandler\ExpireWardenSpawnsHandler;
use App\Scheduler\WardenTtlSchedule;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;

final class ExpireWardenSpawnsHandlerTest extends KernelTestCase
{
    public function testExpiresOnlyOverdueActiveSpawnsAndPublishesEvents(): void
    {
        $container = static::getContainer();
        $em = $container->get(EntityManagerInterface::class);

        $user = new User('reporter@example.com');
        $user->setPassword('x');
        $monster = new Monster('Dragon Warden', 'Dragons', 50);
        $overdue = new WardenSpawn($monster, 'Monza', 'Venore', $user, 7, new \DateTimeImmutable('-10 minutes'));
        $fresh = new WardenSpawn($monster, 'Monza', 'Thais', $user, 7, new \DateTimeImmutable('-1 minute'));
        foreach ([$user, $monster, $overdue, $fresh] as $entity) {
            $em->persist($entity);
        }
        $em->flush();

        $handler = $container->get(ExpireWardenSpawnsHandler::class);
        self::assertSame(1, $handler(new ExpireWardenSpawns()));
        self::assertSame(0, $handler(new ExpireWardenSpawns()), 'a spawn is expired only once');

        $em->clear();
        self::assertSame(WardenSpawnStatus::Expired, $em->find(WardenSpawn::class, $overdue->getId())->getStatus());
        self::assertSame(WardenSpawnStatus::Active, $em->find(WardenSpawn::class, $fresh->getId())->getStatus());

        /** @var InMemoryTransport $transport */
        $transport = $container->get('messenger.transport.discord_events');
        $sent = $transport->getSent();
        self::assertCount(1, $sent);
        self::assertInstanceOf(WardenExpiredEvent::class, $sent[0]->getMessage());
        self::assertSame($overdue->getId()->toRfc4122(), $sent[0]->getMessage()->spawnId);
        self::assertEquals($overdue->getExpiresAt(), $sent[0]->getMessage()->expiresAt);
    }

    public function testScheduleRunsEveryMinute(): void
    {
        $schedule = static::getContainer()->get(WardenTtlSchedule::class)->getSchedule();
        $messages = $schedule->getRecurringMessages();

        self::assertCount(1, $messages);
        self::assertStringContainsString('60', (string) $messages[0]->getTrigger());
    }
}
