<?php

namespace App\Tests\Functional;

use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Message\WardenKilledEvent;
use App\Message\WardenSpawnedEvent;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;

final class WardenSpawnApiTest extends ApiTestCase
{
    public function testReportsSpawnAndPublishesEvent(): void
    {
        $user = $this->createUser(discordUserId: '123456789012345678');
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'monza',
            'location_description' => 'Venore Dragon Lair -2, przy bramce',
            'ttl_minutes' => 10,
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        self::assertSame(['id' => $monster->getId(), 'name' => 'Dragon Warden', 'image_url' => null], $data['monster']);
        self::assertSame('Monza', $data['server_name'], 'world name is canonicalized');
        self::assertSame('ACTIVE', $data['status']);

        $spawn = $this->em->getRepository(WardenSpawn::class)->find($data['id']);
        self::assertNotNull($spawn);
        self::assertSame(600, $spawn->getExpiresAt()->getTimestamp() - $spawn->getCreatedAt()->getTimestamp());
        self::assertSame($spawn->getExpiresAt()->format('Y-m-d\TH:i:s\Z'), $data['expires_at']);

        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        $sent = $transport->getSent();
        self::assertCount(1, $sent);
        $event = $sent[0]->getMessage();
        self::assertInstanceOf(WardenSpawnedEvent::class, $event);
        self::assertSame($data['id'], $event->spawnId);
        self::assertSame('123456789012345678', $event->reportedByDiscordUserId);
    }

    public function testShowsWhoReportedByCharactersOnThatWorldNeverByEmail(): void
    {
        $user = $this->createUser('reporter@example.com');
        $user->linkDiscord('323456789012345678', 'lukasz');
        $this->createCharacter($user, 'Sir Tester', 'Monza');
        $this->createCharacter($user, 'Far Away', 'Secura');
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Venore Dragon Lair',
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        self::assertSame(['characters' => ['Sir Tester'], 'discord_name' => 'lukasz'], $data['reported_by']);

        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        $event = $transport->getSent()[0]->getMessage();
        self::assertSame(['Sir Tester'], $event->reportedByCharacters);
        self::assertSame('lukasz', $event->reportedByName);

        $list = $this->requestJson('GET', '/api/v1/warden-spawns?server_name=Monza', null, $this->tokenFor($user));
        self::assertSame($data['reported_by'], $list['warden_spawns'][0]['reported_by']);
        self::assertStringNotContainsString('reporter@example.com', json_encode($list));
    }

    public function testKeepsTheDiscordServerOfTheReport(): void
    {
        $user = $this->createUser(discordUserId: '123456789012345678');
        $this->fakeDiscordGuilds([['id' => '1234567890123456789', 'name' => 'Guild', 'channels' => ['wardens-monza'], 'members' => ['123456789012345678']]]);
        $monster = $this->createMonster();
        $payload = [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Venore Dragon Lair',
            'discord_guild_id' => '1234567890123456789',
        ];

        $this->requestJson('POST', '/api/v1/warden-spawns', $payload, $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        self::assertSame('1234567890123456789', $transport->getSent()[0]->getMessage()->discordGuildId);

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', ['discord_guild_id' => 'abc'] + $payload, $this->tokenFor($user));
        self::assertResponseStatusCodeSame(422);
        self::assertSame(['discord_guild_id'], array_column($data['violations'], 'property_path'));
    }

    public function testAllowsFiveReportsInFiveMinutes(): void
    {
        $user = $this->createUser(discordUserId: '123456789012345678');
        $other = $this->createUser('other@example.com');
        $monster = $this->createMonster();
        $token = $this->tokenFor($user);
        $payload = ['monster_id' => $monster->getId(), 'server_name' => 'Monza', 'location_description' => 'Venore Dragon Lair'];
        // Older reports and other players' reports do not count.
        foreach ([$user, $user, $other] as $i => $reporter) {
            $this->em->persist(new WardenSpawn($monster, 'Monza', 'Old spot', $reporter, createdAt: new \DateTimeImmutable(\sprintf('-%d minutes', 6 + $i))));
        }
        $this->em->flush();

        for ($i = 0; $i < 5; ++$i) {
            $this->requestJson('POST', '/api/v1/warden-spawns', $payload, $token);
            self::assertResponseStatusCodeSame(201);
        }
        $data = $this->requestJson('POST', '/api/v1/warden-spawns', $payload, $token);

        self::assertResponseStatusCodeSame(429);
        self::assertSame('report_limit', $data['code']);
        self::assertStringStartsWith('You can send at most 5 reports in 5 minutes. Try again in 5 min', $data['detail']);
        self::assertGreaterThan(290, (int) $this->client->getResponse()->headers->get('Retry-After'));
        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        self::assertCount(0, $transport->getSent(), 'the rejected report pings nobody');
        self::assertCount(5 + 2, $this->em->getRepository(WardenSpawn::class)->findBy(['reportedBy' => $user]));
    }

    public function testTheReportLimitFreesUpAsOldReportsLeaveTheWindow(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();
        foreach ([270, 200, 200, 100, 10] as $secondsAgo) {
            $this->em->persist(new WardenSpawn($monster, 'Monza', 'Old spot', $user, createdAt: new \DateTimeImmutable("-{$secondsAgo} seconds")));
        }
        $this->em->flush();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', ['monster_id' => $monster->getId(), 'server_name' => 'Monza', 'location_description' => 'Venore Dragon Lair'], $this->tokenFor($user));

        // The oldest leaves the 5 minute window in 30 seconds.
        self::assertResponseStatusCodeSame(429);
        self::assertMatchesRegularExpression('/Try again in (29|30) s\.$/', $data['detail']);
        self::assertContains((int) $this->client->getResponse()->headers->get('Retry-After'), [29, 30]);
    }

    public function testRejectsADiscordServerThePlayerIsNotIn(): void
    {
        $user = $this->createUser(discordUserId: '123456789012345678');
        $this->fakeDiscordGuilds([['id' => '1234567890123456789', 'name' => 'Guild', 'channels' => ['wardens-monza'], 'members' => []]]);
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Venore Dragon Lair',
            'discord_guild_id' => '1234567890123456789',
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(422);
        self::assertSame(['discord_guild_id'], array_column($data['violations'], 'property_path'));
        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        self::assertCount(0, $transport->getSent());
    }

    public function testListsTheDiscordServersAReportCanGoTo(): void
    {
        $user = $this->createUser(discordUserId: '123456789012345678');
        $this->fakeDiscordGuilds([
            ['id' => '100000000000000001', 'name' => 'Zeta', 'channels' => ['general', 'wardens-monza'], 'members' => ['123456789012345678']],
            ['id' => '100000000000000002', 'name' => 'alpha', 'channels' => ['wardens-monza'], 'members' => ['123456789012345678']],
            ['id' => '100000000000000003', 'name' => 'No channel', 'channels' => ['wardens-secura'], 'members' => ['123456789012345678']],
            ['id' => '100000000000000004', 'name' => 'Not a member', 'channels' => ['wardens-monza'], 'members' => []],
        ]);

        $data = $this->requestJson('GET', '/api/v1/discord-guilds?server_name=monza', null, $this->tokenFor($user));

        self::assertResponseIsSuccessful();
        self::assertTrue($data['enabled']);
        self::assertSame([
            ['id' => '100000000000000002', 'name' => 'alpha'],
            ['id' => '100000000000000001', 'name' => 'Zeta'],
        ], $data['guilds']);
    }

    public function testListsNoDiscordServersForAPlayerWithoutDiscord(): void
    {
        $user = $this->createUser();
        $this->fakeDiscordGuilds([['id' => '100000000000000001', 'name' => 'Zeta', 'channels' => ['wardens-monza'], 'members' => []]]);

        $data = $this->requestJson('GET', '/api/v1/discord-guilds?server_name=Monza', null, $this->tokenFor($user));

        self::assertResponseIsSuccessful();
        self::assertSame([], $data['guilds']);
    }

    public function testStoresCityAndAdditionalInfo(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'city' => 'liberty bay',
            'location_description' => 'Quara Grotto -1',
            'additional_info' => "Wejście od plaży\n<script>x</script>Dwie osoby czekają",
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        self::assertSame('Liberty Bay', $data['city']);
        self::assertSame("Wejście od plaży\nDwie osoby czekają", $data['additional_info']);

        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        self::assertSame('Liberty Bay', $transport->getSent()[0]->getMessage()->city);
    }

    public function testCityAndAdditionalInfoAreOptional(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Somewhere nice',
            'additional_info' => '   ',
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        self::assertNull($data['city']);
        self::assertNull($data['additional_info']);
    }

    public function testRejectsUnknownCityAndTooLongInfo(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'city' => 'Atlantis',
            'location_description' => 'Somewhere nice',
            'additional_info' => str_repeat('a', 501),
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(422);
        self::assertEqualsCanonicalizing(['city', 'additional_info'], array_column($data['violations'], 'property_path'));
    }

    public function testDefaultsTtlToEightMinutes(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Ankrahmun tombs',
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        $spawn = $this->em->getRepository(WardenSpawn::class)->find($data['id']);
        self::assertSame(8 * 60, $spawn->getExpiresAt()->getTimestamp() - $spawn->getCreatedAt()->getTimestamp());
    }

    public function testStripsMarkupFromLocation(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Venore <script>alert(1)</script><b>Lair</b>',
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(201);
        self::assertSame('Venore Lair', $data['location_description']);
    }

    public function testRejectsMissingToken(): void
    {
        $data = $this->requestJson('POST', '/api/v1/warden-spawns', ['monster_id' => 1]);

        self::assertResponseStatusCodeSame(401);
        self::assertResponseHeaderSame('Content-Type', 'application/problem+json');
        self::assertSame(401, $data['status']);
    }

    public function testRejectsInvalidToken(): void
    {
        $this->requestJson('POST', '/api/v1/warden-spawns', ['monster_id' => 1], 'not-a-real-token');

        self::assertResponseStatusCodeSame(401);
    }

    public function testValidationErrorsAreProblemDetails(): void
    {
        $user = $this->createUser();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => 999999,
            'server_name' => 'Atlantis',
            'location_description' => '<i>ab</i>',
            'ttl_minutes' => 11,
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(422);
        self::assertResponseHeaderSame('Content-Type', 'application/problem+json');
        self::assertSame(422, $data['status']);
        self::assertArrayHasKey('title', $data);
        self::assertEqualsCanonicalizing(
            ['monster_id', 'server_name', 'location_description', 'ttl_minutes'],
            array_column($data['violations'], 'property_path'),
        );

        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        self::assertCount(0, $transport->getSent());
    }

    public function testRejectsWrongTypes(): void
    {
        $user = $this->createUser();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => 'dragon',
            'server_name' => 'Monza',
            'location_description' => 'Somewhere nice',
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(422);
        self::assertSame(['monster_id'], array_column($data['violations'], 'property_path'));
    }

    public function testRejectsTtlBelowMinimum(): void
    {
        $user = $this->createUser();
        $monster = $this->createMonster();

        $data = $this->requestJson('POST', '/api/v1/warden-spawns', [
            'monster_id' => $monster->getId(),
            'server_name' => 'Monza',
            'location_description' => 'Somewhere nice',
            'ttl_minutes' => 0,
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(422);
        self::assertSame(['ttl_minutes'], array_column($data['violations'], 'property_path'));
    }

    public function testClosesReportAsKilledAndPublishesEvent(): void
    {
        $closer = $this->createUser('closer@example.com', discordUserId: '223456789012345678');
        $spawn = $this->createSpawn($closer);

        $data = $this->requestJson('POST', \sprintf('/api/v1/warden-spawns/%s/kill', $spawn->getId()), null, $this->tokenFor($closer));

        self::assertResponseIsSuccessful();
        self::assertSame('KILLED', $data['status']);

        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        $event = $transport->getSent()[0]->getMessage();
        self::assertInstanceOf(WardenKilledEvent::class, $event);
        self::assertSame($spawn->getId()->toRfc4122(), $event->spawnId);
        self::assertSame('223456789012345678', $event->killedByDiscordUserId);
        self::assertNull($event->killedByName, 'never the e-mail');

        $list = $this->requestJson('GET', '/api/v1/warden-spawns?server_name=Monza', null, $this->tokenFor($closer));
        self::assertSame([], $list['warden_spawns']);
    }

    public function testOnlyTheReporterCanCloseTheReport(): void
    {
        $reporter = $this->createUser();
        $other = $this->createUser('other@example.com');
        $spawn = $this->createSpawn($reporter);
        [$reporterToken, $otherToken] = [$this->tokenFor($reporter), $this->tokenFor($other)];

        $data = $this->requestJson('POST', \sprintf('/api/v1/warden-spawns/%s/kill', $spawn->getId()), null, $otherToken);

        self::assertResponseStatusCodeSame(403);
        self::assertSame('Only the player who reported this Warden can mark it as gone.', $data['detail']);
        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        self::assertSame([], $transport->getSent());

        $list = $this->requestJson('GET', '/api/v1/warden-spawns?server_name=Monza', null, $otherToken);
        self::assertCount(1, $list['warden_spawns'], 'still active');
        self::assertFalse($list['warden_spawns'][0]['is_yours']);

        $mine = $this->requestJson('GET', '/api/v1/warden-spawns?server_name=Monza', null, $reporterToken);
        self::assertTrue($mine['warden_spawns'][0]['is_yours']);
    }

    public function testCannotCloseAReportTwice(): void
    {
        $user = $this->createUser();
        $spawn = $this->createSpawn($user);
        $uri = \sprintf('/api/v1/warden-spawns/%s/kill', $spawn->getId());

        $this->requestJson('POST', $uri, null, $this->tokenFor($user));
        $data = $this->requestJson('POST', $uri, null, $this->tokenFor($user));

        self::assertResponseStatusCodeSame(409);
        self::assertSame('This report is no longer active.', $data['detail']);
    }

    public function testClosingUnknownReportIsNotFound(): void
    {
        $user = $this->createUser();

        $this->requestJson('POST', '/api/v1/warden-spawns/not-a-uuid/kill', null, $this->tokenFor($user));

        self::assertResponseStatusCodeSame(404);
    }

    private function createSpawn(User $reporter): WardenSpawn
    {
        $spawn = new WardenSpawn($this->createMonster(), 'Monza', 'Venore Dragon Lair', $reporter);
        $this->em->persist($spawn);
        $this->em->flush();

        return $spawn;
    }
}
