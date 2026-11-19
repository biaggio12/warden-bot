<?php

namespace App\Service;

use App\Entity\User;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

/**
 * How a player is named on the website and on Discord: their Discord name, else their
 * characters' names, else "Player #id". Never the e-mail.
 */
final readonly class PlayerNames
{
    /** Characters named before the rest is counted as "+N". */
    private const CHARACTERS_SHOWN = 2;

    public function __construct(private Connection $db)
    {
    }

    /**
     * @param list<int|string> $userIds
     *
     * @return array<int, string> user id => name, for every id given
     */
    public function of(array $userIds): array
    {
        $ids = array_values(array_unique(array_map('intval', $userIds)));
        if ([] === $ids) {
            return [];
        }
        $discord = [];
        foreach ($this->db->fetchAllAssociative('SELECT id, discord_username FROM users WHERE id IN (:ids)', ['ids' => $ids], ['ids' => ArrayParameterType::INTEGER]) as $row) {
            $discord[(int) $row['id']] = $row['discord_username'];
        }
        $characters = [];
        foreach ($this->db->fetchAllAssociative('SELECT user_id, name FROM characters WHERE user_id IN (:ids) ORDER BY name', ['ids' => $ids], ['ids' => ArrayParameterType::INTEGER]) as $row) {
            $characters[(int) $row['user_id']][] = (string) $row['name'];
        }

        $names = [];
        foreach ($ids as $id) {
            $names[$id] = self::format($discord[$id] ?? null, $characters[$id] ?? [], $id);
        }

        return $names;
    }

    public function one(User $user): string
    {
        return $this->of([(int) $user->getId()])[(int) $user->getId()] ?? self::format($user->getDiscordUsername(), [], (int) $user->getId());
    }

    /**
     * @param list<string> $characters
     */
    public static function format(?string $discordUsername, array $characters, int $id): string
    {
        if (null !== $discordUsername && '' !== $discordUsername) {
            return $discordUsername;
        }
        if ([] !== $characters) {
            $more = \count($characters) - self::CHARACTERS_SHOWN;

            return implode(', ', \array_slice($characters, 0, self::CHARACTERS_SHOWN)).($more > 0 ? " +$more" : '');
        }

        return 'Player #'.$id;
    }
}
