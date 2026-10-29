<?php

namespace App\Tests\Functional;

use App\Entity\WardenSpawn;
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
        self::assertSame(['id' => $monster->getId(), 'name' => 'Dragon Warden'], $data['monster']);
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

    public function testDefaultsTtlToSevenMinutes(): void
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
        self::assertSame(7 * 60, $spawn->getExpiresAt()->getTimestamp() - $spawn->getCreatedAt()->getTimestamp());
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
            'ttl_minutes' => 31,
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
            'ttl_minutes' => 2,
        ], $this->tokenFor($user));

        self::assertResponseStatusCodeSame(422);
        self::assertSame(['ttl_minutes'], array_column($data['violations'], 'property_path'));
    }
}
