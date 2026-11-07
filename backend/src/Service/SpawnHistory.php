<?php

namespace App\Service;

use App\Http\Json;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;

/**
 * Past reports: the History tab (newest first, page by page) and the bot's daily,
 * weekly and monthly summaries per world. A report still ACTIVE after its time is
 * shown as EXPIRED, as the expiry worker would leave it.
 */
final readonly class SpawnHistory
{
    public const PAGE = 30;
    private const SUMMARY_TOP = 5;

    public function __construct(
        private Connection $db,
        private ClockInterface $clock,
    ) {
    }

    /**
     * One page of reports, newest first; `$before` is the id of the last report of the
     * previous page (ids are UUIDv7, so they sort by time).
     *
     * @return array{warden_spawns: list<array<string, mixed>>, next_before: ?string}
     */
    public function page(?string $serverName, ?int $monsterId, ?string $before, int $limit = self::PAGE): array
    {
        $where = ['1 = 1'];
        $params = ['now' => $this->now()];
        if (null !== $serverName) {
            $where[] = 'LOWER(s.server_name) = LOWER(:server)';
            $params['server'] = $serverName;
        }
        if (null !== $monsterId) {
            $where[] = 's.monster_id = :monster';
            $params['monster'] = $monsterId;
        }
        if (null !== $before) {
            $where[] = 's.id < :before';
            $params['before'] = $before;
        }

        $rows = $this->db->fetchAllAssociative(
            "SELECT s.id, s.server_name, s.city, s.location_description, s.created_at, s.expires_at, s.reported_by_user_id,
                    CASE WHEN s.status = 'ACTIVE' AND s.expires_at <= :now THEN 'EXPIRED' ELSE s.status END AS status,
                    m.id AS monster_id, m.name AS monster_name, m.image_url,
                    u.discord_username,
                    (SELECT COUNT(DISTINCT p.player) FROM (
                        SELECT json_array_elements_text(wp.on_my_way) AS player FROM warden_spawn_presence wp WHERE wp.spawn_id = s.id
                        UNION SELECT json_array_elements_text(wp.on_site) FROM warden_spawn_presence wp WHERE wp.spawn_id = s.id
                    ) p) AS responded
             FROM warden_spawns s
             JOIN monsters m ON m.id = s.monster_id
             LEFT JOIN users u ON u.id = s.reported_by_user_id
             WHERE ".implode(' AND ', $where).'
             ORDER BY s.id DESC
             LIMIT '.($limit + 1),
            $params,
        );

        $more = \count($rows) > $limit;
        $rows = \array_slice($rows, 0, $limit);
        $names = $this->characterNames($rows);

        return [
            'warden_spawns' => array_map(static fn (array $r): array => [
                'id' => (string) $r['id'],
                'monster' => ['id' => (int) $r['monster_id'], 'name' => (string) $r['monster_name'], 'image_url' => $r['image_url']],
                'server_name' => (string) $r['server_name'],
                'city' => $r['city'],
                'location_description' => (string) $r['location_description'],
                'reported_by' => [
                    'characters' => $names[$r['reported_by_user_id'].'|'.strtolower((string) $r['server_name'])] ?? [],
                    'discord_name' => $r['discord_username'],
                ],
                'status' => (string) $r['status'],
                'responded' => (int) $r['responded'],
                'created_at' => self::iso($r['created_at']),
                'expires_at' => self::iso($r['expires_at']),
            ], $rows),
            'next_before' => $more ? (string) end($rows)['id'] : null,
        ];
    }

    /**
     * What happened on each world from `$since` up to `$until`, for the bot's summaries.
     * Worlds without reports are left out.
     *
     * @return list<array{
     *     server_name: string, reports: int, killed: int, expired: int, active: int, responded: int,
     *     monsters: list<array{name: string, reports: int}>,
     *     reporters: list<array{name: string, reports: int}>
     * }>
     */
    public function summary(\DateTimeImmutable $since, \DateTimeImmutable $until): array
    {
        $utc = new \DateTimeZone('UTC');
        $params = [
            'since' => $since->setTimezone($utc)->format('Y-m-d H:i:s'),
            'until' => $until->setTimezone($utc)->format('Y-m-d H:i:s'),
            'now' => $this->now(),
        ];
        $window = 's.created_at >= :since AND s.created_at < :until';

        $worlds = $this->db->fetchAllAssociative(
            "SELECT s.server_name,
                    COUNT(*) AS reports,
                    COUNT(*) FILTER (WHERE s.status = 'KILLED') AS killed,
                    COUNT(*) FILTER (WHERE s.status = 'EXPIRED' OR (s.status = 'ACTIVE' AND s.expires_at <= :now)) AS expired,
                    COUNT(*) FILTER (WHERE s.status = 'ACTIVE' AND s.expires_at > :now) AS active
             FROM warden_spawns s WHERE $window
             GROUP BY s.server_name ORDER BY reports DESC, s.server_name",
            $params,
        );
        $responded = $this->db->fetchAllKeyValue(
            "SELECT p.server_name, COUNT(DISTINCT p.player) FROM (
                SELECT s.server_name, json_array_elements_text(wp.on_my_way) AS player
                FROM warden_spawn_presence wp JOIN warden_spawns s ON s.id = wp.spawn_id WHERE $window
                UNION
                SELECT s.server_name, json_array_elements_text(wp.on_site)
                FROM warden_spawn_presence wp JOIN warden_spawns s ON s.id = wp.spawn_id WHERE $window
             ) p GROUP BY p.server_name",
            $params,
        );
        $monsters = $this->db->fetchAllAssociative(
            "SELECT s.server_name, m.name, COUNT(*) AS reports
             FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id WHERE $window
             GROUP BY s.server_name, m.name ORDER BY reports DESC, m.name",
            $params,
        );
        // The reporter as players know them: a character on that world, else the Discord name.
        $reporters = $this->db->fetchAllAssociative(
            "SELECT s.server_name, COALESCE(
                        (SELECT c.name FROM characters c WHERE c.user_id = s.reported_by_user_id AND LOWER(c.server_name) = LOWER(s.server_name) ORDER BY c.name LIMIT 1),
                        u.discord_username, 'deleted account') AS name,
                    COUNT(*) AS reports
             FROM warden_spawns s LEFT JOIN users u ON u.id = s.reported_by_user_id WHERE $window
             GROUP BY s.server_name, s.reported_by_user_id, u.discord_username ORDER BY reports DESC, name",
            $params,
        );

        return array_map(static function (array $w) use ($responded, $monsters, $reporters): array {
            $of = static fn (array $rows): array => \array_slice(array_values(array_map(
                static fn (array $r): array => ['name' => (string) $r['name'], 'reports' => (int) $r['reports']],
                array_filter($rows, static fn (array $r): bool => $r['server_name'] === $w['server_name']),
            )), 0, self::SUMMARY_TOP);

            return [
                'server_name' => (string) $w['server_name'],
                'reports' => (int) $w['reports'],
                'killed' => (int) $w['killed'],
                'expired' => (int) $w['expired'],
                'active' => (int) $w['active'],
                'responded' => (int) ($responded[$w['server_name']] ?? 0),
                'monsters' => $of($monsters),
                'reporters' => $of($reporters),
            ];
        }, $worlds);
    }

    /**
     * The reporters' characters on each report's world (at most 3), keyed "userId|world".
     *
     * @param list<array<string, mixed>> $rows
     *
     * @return array<string, list<string>>
     */
    private function characterNames(array $rows): array
    {
        $users = array_values(array_unique(array_filter(array_map(static fn (array $r) => $r['reported_by_user_id'], $rows))));
        if ([] === $users) {
            return [];
        }
        $names = [];
        foreach ($this->db->fetchAllAssociative(
            'SELECT user_id, server_name, name FROM characters WHERE user_id IN (:users) ORDER BY name',
            ['users' => $users],
            ['users' => ArrayParameterType::INTEGER],
        ) as $c) {
            $key = $c['user_id'].'|'.strtolower((string) $c['server_name']);
            if (\count($names[$key] ?? []) < 3) {
                $names[$key][] = (string) $c['name'];
            }
        }

        return $names;
    }

    private function now(): string
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private static function iso(mixed $databaseTime): string
    {
        return Json::date(new \DateTimeImmutable((string) $databaseTime, new \DateTimeZone('UTC')));
    }
}
