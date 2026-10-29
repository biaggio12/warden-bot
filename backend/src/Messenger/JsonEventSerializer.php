<?php

namespace App\Messenger;

use App\Message\WardenExpiredEvent;
use App\Message\WardenSpawnedEvent;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\Exception\MessageDecodingFailedException;
use Symfony\Component\Messenger\Transport\Serialization\SerializerInterface;

/**
 * Language-neutral wire format for integration events, so the TypeScript bot can
 * read them without knowing anything about PHP serialization:
 *
 *   {"event": "warden.spawned", "occurred_at": "...", "data": {...}}
 */
final class JsonEventSerializer implements SerializerInterface
{
    public const SPAWNED = 'warden.spawned';
    public const EXPIRED = 'warden.expired';

    public function encode(Envelope $envelope): array
    {
        $message = $envelope->getMessage();

        [$type, $data] = match (true) {
            $message instanceof WardenSpawnedEvent => [self::SPAWNED, [
                'spawn_id' => $message->spawnId,
                'monster' => [
                    'id' => $message->monsterId,
                    'name' => $message->monsterName,
                    'category' => $message->monsterCategory,
                    'image_url' => $message->monsterImageUrl,
                ],
                'server_name' => $message->serverName,
                'city' => $message->city,
                'location_description' => $message->locationDescription,
                'additional_info' => $message->additionalInfo,
                'reported_by_discord_user_id' => '' !== $message->reportedByDiscordUserId ? $message->reportedByDiscordUserId : null,
                'created_at' => self::formatDate($message->createdAt),
                'expires_at' => self::formatDate($message->expiresAt),
            ]],
            $message instanceof WardenExpiredEvent => [self::EXPIRED, [
                'spawn_id' => $message->spawnId,
                'monster_id' => $message->monsterId,
                'server_name' => $message->serverName,
                'expires_at' => self::formatDate($message->expiresAt),
            ]],
            default => throw new \InvalidArgumentException(\sprintf('Message "%s" is not an integration event.', $message::class)),
        };

        return [
            'body' => json_encode([
                'event' => $type,
                'occurred_at' => self::formatDate(new \DateTimeImmutable()),
                'data' => $data,
            ], \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_UNICODE | \JSON_UNESCAPED_SLASHES),
            'headers' => [
                'type' => $type,
                'Content-Type' => 'application/json',
            ],
        ];
    }

    public function decode(array $encodedEnvelope): Envelope
    {
        try {
            $payload = json_decode($encodedEnvelope['body'] ?? '', true, 512, \JSON_THROW_ON_ERROR);
            $data = $payload['data'];

            $message = match ($payload['event'] ?? null) {
                self::SPAWNED => new WardenSpawnedEvent(
                    spawnId: $data['spawn_id'],
                    monsterId: $data['monster']['id'],
                    monsterName: $data['monster']['name'],
                    monsterCategory: $data['monster']['category'],
                    monsterImageUrl: $data['monster']['image_url'] ?? null,
                    serverName: $data['server_name'],
                    locationDescription: $data['location_description'],
                    city: $data['city'] ?? null,
                    additionalInfo: $data['additional_info'] ?? null,
                    reportedByDiscordUserId: (string) ($data['reported_by_discord_user_id'] ?? ''),
                    createdAt: new \DateTimeImmutable($data['created_at']),
                    expiresAt: new \DateTimeImmutable($data['expires_at']),
                ),
                self::EXPIRED => new WardenExpiredEvent(
                    spawnId: $data['spawn_id'],
                    monsterId: $data['monster_id'],
                    serverName: $data['server_name'],
                    expiresAt: new \DateTimeImmutable($data['expires_at']),
                ),
                default => throw new MessageDecodingFailedException('Unknown event type.'),
            };
        } catch (\JsonException|\TypeError|\ErrorException $e) {
            throw new MessageDecodingFailedException('Malformed integration event: '.$e->getMessage(), 0, $e);
        }

        return new Envelope($message);
    }

    public static function formatDate(\DateTimeImmutable $date): string
    {
        return $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }
}
