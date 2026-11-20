<?php

namespace App\Service;

use App\Http\DateWindow;
use App\Http\Json;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;

/**
 * How one player has reported Wardens, for the admin's Players tab: how often, how
 * recently, how the reports ended, on which worlds, which monsters, and the latest ones.
 * With a date window everything but `last_7_days` / `last_30_days` counts only the reports
 * made in it.
 *
 * `unconfirmed`: reports that ended without anyone confirming them (the rules of the points,
 * see ReportScoring). Many of those may mean made-up Wardens.
 */
final readonly class ReporterStats
{
    public const RECENT = 20;
    public const TOP_MONSTERS = 10;
    /** A player is flagged once this many of their reports have ended... */
    public const FLAG_MIN_ENDED = 5;
    /** ...and at least this share of them were never confirmed. */
    public const FLAG_UNCONFIRMED_SHARE = 0.5;

    /** SQL condition: report `s` (reporter `u`) is over and nobody confirmed it. `:now` is the current time. */
    public static function unconfirmedSql(): string
    {
        return "(s.status = 'EXPIRED' OR (s.status = 'ACTIVE' AND s.expires_at <= :now)) AND NOT ".ReportScoring::confirmedSql();
    }

    /** Whether `$unconfirmed` of `$ended` reports is enough to flag the reporter. */
    public static function flagged(int $ended, int $unconfirmed): bool
    {
        return $ended >= self::FLAG_MIN_ENDED && $unconfirmed >= $ended * self::FLAG_UNCONFIRMED_SHARE;
    }

    public function __construct(
        private Connection $db,
        private ClockInterface $clock,
    ) {
    }

    /**
     * @return array{
     *     total: int, last_7_days: int, last_30_days: int, first_report_at: ?string, last_report_at: ?string,
     *     by_status: array{active: int, killed: int, expired: int}, unconfirmed: int, flagged: bool,
     *     worlds: list<array{server_name: string, reports: int}>,
     *     monsters: list<array{name: string, image_url: ?string, reports: int}>,
     *     recent: list<array{id: string, monster: string, image_url: ?string, server_name: string, location: string, city: ?string, status: string, created_at: string}>
     * }
     */
    public function of(int $userId, ?DateWindow $window = null): array
    {
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        [$windowWhere, $windowParams] = $window?->sql('s.created_at') ?? [[], []];
        $in = implode('', array_map(static fn (string $condition): string => " AND $condition", $windowWhere));
        $base = ['user' => $userId] + $windowParams;
        $summary = $this->db->fetchAssociative(
            "SELECT COUNT(*) FILTER (WHERE TRUE$in) AS total,
                    COUNT(*) FILTER (WHERE s.created_at >= :week) AS last_7_days,
                    COUNT(*) FILTER (WHERE s.created_at >= :month) AS last_30_days,
                    COUNT(*) FILTER (WHERE s.status = 'ACTIVE' AND s.expires_at > :now$in) AS active,
                    COUNT(*) FILTER (WHERE s.status = 'KILLED'$in) AS killed,
                    COUNT(*) FILTER (WHERE (s.status = 'EXPIRED' OR (s.status = 'ACTIVE' AND s.expires_at <= :now))$in) AS expired,
                    COUNT(*) FILTER (WHERE ".self::unconfirmedSql()."$in) AS unconfirmed,
                    MIN(s.created_at) FILTER (WHERE TRUE$in) AS first_report_at,
                    MAX(s.created_at) FILTER (WHERE TRUE$in) AS last_report_at
             FROM warden_spawns s JOIN users u ON u.id = s.reported_by_user_id WHERE s.reported_by_user_id = :user",
            $base + [
                'now' => $now->format('Y-m-d H:i:s'),
                'week' => $now->modify('-7 days')->format('Y-m-d H:i:s'),
                'month' => $now->modify('-30 days')->format('Y-m-d H:i:s'),
            ],
        ) ?: [];

        $worlds = $this->db->fetchAllAssociative(
            "SELECT s.server_name, COUNT(*) AS reports FROM warden_spawns s WHERE s.reported_by_user_id = :user$in
             GROUP BY s.server_name ORDER BY reports DESC, s.server_name",
            $base,
        );
        $monsters = $this->db->fetchAllAssociative(
            "SELECT m.name, m.image_url, COUNT(*) AS reports FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id
             WHERE s.reported_by_user_id = :user$in GROUP BY m.id, m.name, m.image_url ORDER BY reports DESC, m.name LIMIT ".self::TOP_MONSTERS,
            $base,
        );
        $recent = $this->db->fetchAllAssociative(
            "SELECT s.id, m.name AS monster, m.image_url, s.server_name, s.location_description, s.city, CASE WHEN s.status = 'ACTIVE' AND s.expires_at <= :now THEN 'EXPIRED' ELSE s.status END AS status, s.created_at
             FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id
             WHERE s.reported_by_user_id = :user$in ORDER BY s.created_at DESC, s.id DESC LIMIT ".self::RECENT,
            $base + ['now' => $now->format('Y-m-d H:i:s')],
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
            'unconfirmed' => (int) ($summary['unconfirmed'] ?? 0),
            'flagged' => self::flagged((int) ($summary['killed'] ?? 0) + (int) ($summary['expired'] ?? 0), (int) ($summary['unconfirmed'] ?? 0)),
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
