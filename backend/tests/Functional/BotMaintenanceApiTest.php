<?php

namespace App\Tests\Functional;

use App\Entity\AdminAction;
use App\Message\BotBackOnlineEvent;
use App\Message\BotMaintenanceEvent;
use App\Security\AdminPolicy;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;

final class BotMaintenanceApiTest extends ApiTestCase
{
    private const ADMIN_DISCORD_ID = '111111111111111111';

    public function testAdminPostsTheNoticeToTheBot(): void
    {
        $token = $this->adminToken();

        $data = $this->requestJson('POST', '/api/v1/admin/bot-maintenance', ['minutes' => 15, 'message' => '  New: element sensitivities '], $token);

        self::assertResponseStatusCodeSame(202);
        $event = $this->sentEvents()[0];
        self::assertInstanceOf(BotMaintenanceEvent::class, $event);
        self::assertSame('New: element sensitivities', $event->note);
        self::assertSame($data['back_at'], $event->backAt?->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z'));
        self::assertEqualsWithDelta(time() + 15 * 60, $event->backAt->getTimestamp(), 5);

        $entry = $this->em->getRepository(AdminAction::class)->findOneBy([])->toArray();
        self::assertSame(['bot_maintenance', 'Discord', 'back in about 15 min'], [$entry['action'], $entry['player'], $entry['details']]);
    }

    public function testTimeAndMessageAreOptional(): void
    {
        $token = $this->adminToken();

        $data = $this->requestJson('POST', '/api/v1/admin/bot-maintenance', ['message' => '   '], $token);

        self::assertResponseStatusCodeSame(202);
        self::assertNull($data['back_at']);
        $event = $this->sentEvents()[0];
        self::assertNull($event->backAt);
        self::assertNull($event->note);
    }

    public function testRejectsAnOutOfRangeTime(): void
    {
        $token = $this->adminToken();

        $this->requestJson('POST', '/api/v1/admin/bot-maintenance', ['minutes' => 0], $token);

        self::assertResponseStatusCodeSame(422);
        self::assertSame([], $this->sentEvents());
    }

    public function testOnlyAdminsMayPostIt(): void
    {
        $moderator = $this->createUser('mod@example.com', '123456789012345678');
        $moderator->setModerator(true);
        $this->em->flush();
        $token = $this->tokenFor($moderator);
        $this->grantAdmins();

        $this->requestJson('POST', '/api/v1/admin/bot-maintenance', ['minutes' => 15], $token);

        self::assertResponseStatusCodeSame(403);
        self::assertSame([], $this->sentEvents());
    }

    public function testAdminPostsThatTheBotIsBack(): void
    {
        $token = $this->adminToken();

        $this->requestJson('POST', '/api/v1/admin/bot-back-online', ['message' => ' New: element sensitivities '], $token);

        self::assertResponseStatusCodeSame(202);
        $event = $this->sentEvents()[0];
        self::assertInstanceOf(BotBackOnlineEvent::class, $event);
        self::assertSame('New: element sensitivities', $event->note);
        $entry = $this->em->getRepository(AdminAction::class)->findOneBy([])->toArray();
        self::assertSame(['bot_back_online', 'Discord'], [$entry['action'], $entry['player']]);
    }

    public function testOnlyAdminsMayPostThatTheBotIsBack(): void
    {
        $token = $this->tokenFor($this->createUser('player@example.com', '123456789012345678'));
        $this->grantAdmins();

        $this->requestJson('POST', '/api/v1/admin/bot-back-online', [], $token);

        self::assertResponseStatusCodeSame(403);
        self::assertSame([], $this->sentEvents());
    }

    /** @return list<object> */
    private function sentEvents(): array
    {
        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');

        return array_map(static fn ($envelope) => $envelope->getMessage(), $transport->getSent());
    }

    private function adminToken(): string
    {
        $token = $this->tokenFor($this->createUser('admin@example.com', self::ADMIN_DISCORD_ID));
        $this->grantAdmins();

        return $token;
    }

    private function grantAdmins(): void
    {
        $this->client->disableReboot();
        static::getContainer()->set(AdminPolicy::class, new AdminPolicy(self::ADMIN_DISCORD_ID));
    }
}
