<?php

namespace App\Service;

use App\Http\Json;
use App\Security\AdminPolicy;
use Doctrine\DBAL\Connection;

/**
 * Every registered account for the admin's Players list: who they are, when they
 * joined and how active they are. Contains e-mails, so only AdminController reads it.
 */
final readonly class UserDirectory
{
    public function __construct(
        private Connection $db,
        private AdminPolicy $admins,
    ) {
    }

    /** One account as in the list, or null when it does not exist. */
    public function one(int $id): ?array
    {
        return $this->all($id)[0] ?? null;
    }

    /**
     * Newest accounts first.
     *
     * @return list<array{id: int, email: ?string, discord_username: ?string, discord_linked: bool, is_admin: bool, is_moderator: bool, blocked: bool, created_at: string, characters: list<array{id: string, name: string, server_name: string}>, reports: int, last_report_at: ?string, bestiary_marks: int}>
     */
    public function all(?int $only = null): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT u.id, u.email, u.discord_username, u.discord_user_id, u.created_at, u.blocked_at, u.moderator,
                    (SELECT COUNT(*) FROM warden_spawns s WHERE s.reported_by_user_id = u.id) AS reports,
                    (SELECT MAX(s.created_at) FROM warden_spawns s WHERE s.reported_by_user_id = u.id) AS last_report_at,
                    (SELECT COUNT(*) FROM character_killed_monsters k JOIN characters c ON c.id = k.character_id
                      WHERE c.user_id = u.id) AS bestiary_marks
             FROM users u
             WHERE CAST(:only AS INT) IS NULL OR u.id = :only
             ORDER BY u.created_at DESC, u.id DESC',
            ['only' => $only],
        );
        $characters = [];
        foreach ($this->db->fetchAllAssociative('SELECT id, user_id, name, server_name FROM characters ORDER BY name') as $c) {
            $characters[(int) $c['user_id']][] = ['id' => (string) $c['id'], 'name' => (string) $c['name'], 'server_name' => (string) $c['server_name']];
        }

        return array_map(fn (array $r): array => [
            'id' => (int) $r['id'],
            'email' => $r['email'],
            'discord_username' => $r['discord_username'],
            'discord_linked' => null !== $r['discord_user_id'],
            'is_admin' => $this->admins->isDiscordIdAdmin($r['discord_user_id']),
            'is_moderator' => (bool) $r['moderator'] && !$this->admins->isDiscordIdAdmin($r['discord_user_id']),
            'blocked' => null !== $r['blocked_at'],
            'created_at' => self::iso((string) $r['created_at']),
            'characters' => $characters[(int) $r['id']] ?? [],
            'reports' => (int) $r['reports'],
            'last_report_at' => null === $r['last_report_at'] ? null : self::iso((string) $r['last_report_at']),
            'bestiary_marks' => (int) $r['bestiary_marks'],
        ], $rows);
    }

    private static function iso(string $databaseTime): string
    {
        return Json::date(new \DateTimeImmutable($databaseTime, new \DateTimeZone('UTC')));
    }
}
