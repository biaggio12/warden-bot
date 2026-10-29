<?php

namespace App\Tests\Unit;

use App\Message\WardenExpiredEvent;
use App\Message\WardenSpawnedEvent;
use App\Messenger\JsonEventSerializer;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Messenger\Envelope;

final class JsonEventSerializerTest extends TestCase
{
    public function testSpawnedEventWireFormat(): void
    {
        $serializer = new JsonEventSerializer();
        $event = new WardenSpawnedEvent(
            spawnId: 'c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b',
            monsterId: 142,
            monsterName: 'Dragon Warden',
            monsterCategory: 'Dragons',
            monsterImageUrl: 'https://static.wikia.nocookie.net/tibia/images/e/e0/Dragon.gif',
            serverName: 'Monza',
            locationDescription: 'Dragon Lair -2',
            city: 'Venore',
            additionalInfo: "Przy bramce\nUważaj na PK",
            reportedByDiscordUserId: '',
            createdAt: new \DateTimeImmutable('2026-10-29T12:00:00Z'),
            expiresAt: new \DateTimeImmutable('2026-10-29T12:07:00Z'),
        );

        $encoded = $serializer->encode(new Envelope($event));
        $body = json_decode($encoded['body'], true);

        self::assertSame('warden.spawned', $encoded['headers']['type']);
        self::assertSame('warden.spawned', $body['event']);
        self::assertSame(['id' => 142, 'name' => 'Dragon Warden', 'category' => 'Dragons', 'image_url' => 'https://static.wikia.nocookie.net/tibia/images/e/e0/Dragon.gif'], $body['data']['monster']);
        self::assertSame('2026-10-29T12:07:00Z', $body['data']['expires_at']);
        self::assertNull($body['data']['reported_by_discord_user_id']);
        self::assertSame('Venore', $body['data']['city']);
        self::assertSame("Przy bramce\nUważaj na PK", $body['data']['additional_info']);

        self::assertEquals($event, $serializer->decode($encoded)->getMessage());
    }

    public function testExpiredEventRoundTrip(): void
    {
        $serializer = new JsonEventSerializer();
        $event = new WardenExpiredEvent('c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b', 142, 'Monza', new \DateTimeImmutable('2026-10-29T12:07:00Z'));

        $encoded = $serializer->encode(new Envelope($event));

        self::assertSame('warden.expired', json_decode($encoded['body'], true)['event']);
        self::assertEquals($event, $serializer->decode($encoded)->getMessage());
    }
}
