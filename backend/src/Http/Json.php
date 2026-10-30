<?php

namespace App\Http;

use App\Entity\Character;
use App\Entity\Monster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Messenger\JsonEventSerializer;

/**
 * Explicit response shapes for the public API contract.
 */
final class Json
{
    public static function date(\DateTimeImmutable $date): string
    {
        return JsonEventSerializer::formatDate($date);
    }

    /**
     * @return array<string, mixed>
     */
    public static function user(User $user): array
    {
        return [
            'id' => $user->getId(),
            'email' => $user->getEmail(),
            'display_name' => $user->getDisplayName(),
            'discord_linked' => null !== $user->getDiscordUserId(),
            'discord_username' => $user->getDiscordUsername(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function monster(Monster $monster): array
    {
        return [
            'id' => $monster->getId(),
            'name' => $monster->getName(),
            'category' => $monster->getCategory(),
            'charm_points' => $monster->getCharmPoints(),
            'image_url' => $monster->getImageUrl(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function character(Character $character): array
    {
        return [
            'id' => $character->getId()->toRfc4122(),
            'name' => $character->getName(),
            'server_name' => $character->getServerName(),
        ];
    }

    /**
     * @param array{characters: list<string>, discord_name: ?string} $reportedBy see ReporterInfo
     *
     * @return array<string, mixed>
     */
    public static function wardenSpawn(WardenSpawn $spawn, array $reportedBy): array
    {
        return [
            'id' => $spawn->getId()->toRfc4122(),
            'monster' => [
                'id' => $spawn->getMonster()->getId(),
                'name' => $spawn->getMonster()->getName(),
                'image_url' => $spawn->getMonster()->getImageUrl(),
            ],
            'server_name' => $spawn->getServerName(),
            'city' => $spawn->getCity(),
            'location_description' => $spawn->getLocationDescription(),
            'additional_info' => $spawn->getAdditionalInfo(),
            'reported_by' => $reportedBy,
            'status' => $spawn->getStatus()->value,
            'created_at' => self::date($spawn->getCreatedAt()),
            'expires_at' => self::date($spawn->getExpiresAt()),
        ];
    }
}
