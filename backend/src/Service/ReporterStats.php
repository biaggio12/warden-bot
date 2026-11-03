<?php

namespace App\Service;

use App\Http\Json;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;

/**
 * How one player has reported Wardens, for the admin's Players tab: how often, how
 * recently, how the reports ended, on which worlds, which monsters, and the latest ones.
 */
final readonly class ReporterStats
{
    public const RECENT = 20;
    public const TOP_MONSTERS = 10;

    public function __construct(
        private Connection $db,
        private ClockInterface $clock,
    ) {
    }

    /**
     * @return array{
     *     total: int, last_7_days: int, last_30_days: int, first_report_at: ?string, last_report_at: ?string,
     *     by_status: array{active: int, killed: int, expired: int},
     *     worlds: list<array{server_name: string, reports: int}>,
     *     monsters: list<array{name: string, image_url: ?string, reports: int}>,
     *     recent: list<array{id: string, monster: string, image_url: ?string, server_name: string, location: string, city: ?string, status: string, created_at: string}>
     * }
     */
    public function of(int $userId): array
    {
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        $summary = $this->db->fetchAssociative(
            "SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE created_at >= :week) AS last_7_days,
                    COUNT(*) FILTER (WHERE created_at >= :month) AS last_30_days,
                    COUNT(*) FILTER (WHERE status = 'ACTIVE' AND expires_at > :now) AS active,
                    COUNT(*) FILTER (WHERE status = 'KILLED') AS killed,
                    COUNT(*) FILTER (WHERE status = 'EXPIRED' OR (status = 'ACTIVE' AND expires_at <= :now)) AS expired,
                    MIN(created_at) AS first_report_at,
                    MAX(created_at) AS last_report_at
             FROM warden_spawns WHERE reported_by_user_id = :user",
            [
                'user' => $userId,
                'now' => $now->format('Y-m-d H:i:s'),
                'week' => $now->modify('-7 days')->format('Y-m-d H:i:s'),
                'month' => $now->modify('-30 days')->format('Y-m-d H:i:s'),
            ],
        ) ?: [];

        $worlds = $this->db->fetchAllAssociative(
            'SELECT server_name, COUNT(*) AS reports FROM warden_spawns WHERE reported_by_user_id = :user
             GROUP BY server_name ORDER BY reports DESC, server_name',
            ['user' => $userId],
        );
        $monsters = $this->db->fetchAllAssociative(
            'SELECT m.name, m.image_url, COUNT(*) AS reports FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id
             WHERE s.reported_by_user_id = :user GROUP BY m.id, m.name, m.image_url ORDER BY reports DESC, m.name LIMIT '.self::TOP_MONSTERS,
            ['user' => $userId],
        );
        $recent = $this->db->fetchAllAssociative(
            "SELECT s.id, m.name AS monster, m.image_url, s.server_name, s.location_description, s.city, CASE WHEN s.status = 'ACTIVE' AND s.expires_at <= :now THEN 'EXPIRED' ELSE s.status END AS status, s.created_at
             FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id
             WHERE s.reported_by_user_id = :user ORDER BY s.created_at DESC, s.id DESC LIMIT ".self::RECENT,
            ['user' => $userId, 'now' => $now->format('Y-m-d H:i:s')],
        );

        return [
            'total' => (int) ($summary['total'] ?? 0),
            'last_7_days' => (int) ($summary['last_7_days'] ?? 0),
            'last_30_days' => (int) ($summary['last_30_days'] ?? 0),
            'first_report_at' => self::iso($summary['first_report_at'] ?? null),
            'last_report_at' => self::iso($summary['last_report_at'] ?? null),
            'by_status' => [
                'active' => (int) ($summary['active'] ?? 0),
                'killed' => (int) ($summary['killed'] ?? 0),
                'expired' => (int) ($summary['expired'] ?? 0),
            ],
            'worlds' => array_map(static fn (array $r): array => ['server_name' => (string) $r['server_name'], 'reports' => (int) $r['reports']], $worlds),
            'monsters' => array_map(static fn (array $r): array => [
                'name' => (string) $r['name'],
                'image_url' => $r['image_url'],
                'reports' => (int) $r['reports'],
            ], $monsters),
            'recent' => array_map(static fn (array $r): array => [
                'id' => (string) $r['id'],
                'monster' => (string) $r['monster'],
                'image_url' => $r['image_url'],
                'server_name' => (string) $r['server_name'],
                'location' => (string) $r['location_description'],
                'city' => $r['city'],
                'status' => (string) $r['status'],
                'created_at' => (string) self::iso($r['created_at']),
            ], $recent),
        ];
    }

    private static function iso(mixed $databaseTime): ?string
    {
        return null === $databaseTime ? null : Json::date(new \DateTimeImmutable((string) $databaseTime, new \DateTimeZone('UTC')));
    }
}
