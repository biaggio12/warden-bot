<?php

namespace App\Service;

use App\Entity\User;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;

/**
 * Read-only aggregates for the Stats tab: report activity, the reporter leaderboard and
 * the current player's own numbers. Plain SQL - these are group-bys, not entity graphs.
 */
final readonly class StatsService
{
    public const PERIODS = ['7d' => 7, '30d' => 30, 'all' => null];
    /** Days shown in the daily chart for the "all" period. */
    private const ALL_TIME_CHART_DAYS = 90;
    private const TOP = 10;

    public function __construct(
        private Connection $db,
        private ClockInterface $clock,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function build(string $period, User $viewer): array
    {
        $now = $this->clock->now();
        $days = self::PERIODS[$period];
        $since = null === $days ? null : $now->setTime(0, 0)->modify(\sprintf('-%d days', $days - 1));
        $sinceSql = null === $since ? '1970-01-01 00:00:00' : $since->format('Y-m-d H:i:s');

        $leaderboard = $this->leaderboard($sinceSql);
        $mine = array_values(array_filter($leaderboard, static fn (array $row) => $row['user_id'] === $viewer->getId()))[0] ?? null;

        return [
            'period' => $period,
            'totals' => $this->totals($sinceSql, $now),
            'reports_per_day' => $this->reportsPerDay($now, $days ?? self::ALL_TIME_CHART_DAYS),
            'top_monsters' => $this->top('SELECT m.name AS label, COUNT(*) AS count FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id WHERE s.created_at >= :since GROUP BY m.name', $sinceSql),
            'top_cities' => $this->top('SELECT s.city AS label, COUNT(*) AS count FROM warden_spawns s WHERE s.created_at >= :since AND s.city IS NOT NULL GROUP BY s.city', $sinceSql),
            'leaderboard' => array_map(
                static fn (array $row) => [
                    'rank' => $row['rank'],
                    'player' => $row['player'],
                    'reports' => $row['reports'],
                    'is_you' => $row['user_id'] === $viewer->getId(),
                ],
                \array_slice($leaderboard, 0, self::TOP),
            ),
            'bestiary_leaderboard' => $this->bestiaryLeaderboard($viewer),
            'you' => [
                'reports' => $mine['reports'] ?? 0,
                'rank' => $mine['rank'] ?? null,
                'reporters' => \count($leaderboard),
                'reports_all_time' => (int) $this->db->fetchOne('SELECT COUNT(*) FROM warden_spawns WHERE reported_by_user_id = :u', ['u' => $viewer->getId()]),
                'characters' => $this->bestiaryProgress($viewer),
            ],
        ];
    }

    /**
     * @return array{reports: int, reporters: int, monsters: int, active_now: int}
     */
    private function totals(string $since, \DateTimeImmutable $now): array
    {
        $row = $this->db->fetchAssociative(
            'SELECT COUNT(*) AS reports,
                    COUNT(DISTINCT reported_by_user_id) AS reporters,
                    COUNT(DISTINCT monster_id) AS monsters
             FROM warden_spawns WHERE created_at >= :since',
            ['since' => $since],
        );
        $active = $this->db->fetchOne(
            "SELECT COUNT(*) FROM warden_spawns WHERE status = 'ACTIVE' AND expires_at > :now",
            ['now' => $now->format('Y-m-d H:i:s')],
        );

        return [
            'reports' => (int) $row['reports'],
            'reporters' => (int) $row['reporters'],
            'monsters' => (int) $row['monsters'],
            'active_now' => (int) $active,
        ];
    }

    /**
     * One row per day (UTC), including days without reports.
     *
     * @return list<array{date: string, count: int}>
     */
    private function reportsPerDay(\DateTimeImmutable $now, int $days): array
    {
        $rows = $this->db->fetchAllAssociative(
            "SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date, COUNT(s.id) AS count
             FROM generate_series(CAST(:from AS date), CAST(:to AS date), interval '1 day') AS d(day)
             LEFT JOIN warden_spawns s ON s.created_at >= d.day AND s.created_at < d.day + interval '1 day'
             GROUP BY d.day ORDER BY d.day",
            [
                'from' => $now->modify(\sprintf('-%d days', $days - 1))->format('Y-m-d'),
                'to' => $now->format('Y-m-d'),
            ],
        );

        return array_map(static fn (array $r) => ['date' => $r['date'], 'count' => (int) $r['count']], $rows);
    }

    /**
     * @return list<array{label: string, count: int}>
     */
    private function top(string $groupedSql, string $since): array
    {
        $rows = $this->db->fetchAllAssociative($groupedSql.' ORDER BY count DESC, label ASC LIMIT '.self::TOP, ['since' => $since]);

        return array_map(static fn (array $r) => ['label' => (string) $r['label'], 'count' => (int) $r['count']], $rows);
    }

    /**
     * Every reporter in the period, ranked (ties share a rank).
     *
     * @return list<array{user_id: int, player: string, reports: int, rank: int}>
     */
    private function leaderboard(string $since): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT u.id AS user_id, u.email, u.discord_username, COUNT(*) AS reports,
                    RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
             FROM warden_spawns s JOIN users u ON u.id = s.reported_by_user_id
             WHERE s.created_at >= :since
             GROUP BY u.id ORDER BY reports DESC, u.id ASC',
            ['since' => $since],
        );

        return array_map(static fn (array $r) => [
            'user_id' => (int) $r['user_id'],
            'player' => self::publicName($r['discord_username'], $r['email']),
            'reports' => (int) $r['reports'],
            'rank' => (int) $r['rank'],
        ], $rows);
    }

    /**
     * Name shown to other players: the Discord name, otherwise only the start of the
     * e-mail's local part - full addresses are never exposed in the leaderboard.
     */
    public static function publicName(?string $discordUsername, ?string $email): string
    {
        if (null !== $discordUsername && '' !== $discordUsername) {
            return $discordUsername;
        }
        if (null === $email || '' === $email) {
            return 'Player';
        }

        return mb_substr(strstr($email, '@', true) ?: $email, 0, 2).'…';
    }

    /**
     * Characters with the most monsters marked in the bestiary, all time (the bestiary
     * only grows, and bulk marking would make a per-period count meaningless). Ties share
     * a rank; characters with nothing marked are left out.
     *
     * @return list<array{rank: int, character: string, server_name: string, killed: int, total: int, is_you: bool}>
     */
    private function bestiaryLeaderboard(User $viewer): array
    {
        $total = (int) $this->db->fetchOne('SELECT COUNT(*) FROM monsters');
        $rows = $this->db->fetchAllAssociative(
            'SELECT c.name, c.server_name, c.user_id, COUNT(*) AS killed,
                    RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
             FROM character_killed_monsters k JOIN characters c ON c.id = k.character_id
             GROUP BY c.id, c.name, c.server_name, c.user_id
             ORDER BY killed DESC, c.name ASC
             LIMIT '.self::TOP,
        );

        return array_map(static fn (array $r) => [
            'rank' => (int) $r['rank'],
            'character' => (string) $r['name'],
            'server_name' => (string) $r['server_name'],
            'killed' => (int) $r['killed'],
            'total' => $total,
            'is_you' => (int) $r['user_id'] === $viewer->getId(),
        ], $rows);
    }

    /**
     * @return list<array{name: string, server_name: string, killed: int, total: int}>
     */
    private function bestiaryProgress(User $viewer): array
    {
        $total = (int) $this->db->fetchOne('SELECT COUNT(*) FROM monsters');
        $rows = $this->db->fetchAllAssociative(
            'SELECT c.name, c.server_name, COUNT(k.monster_id) AS killed
             FROM characters c LEFT JOIN character_killed_monsters k ON k.character_id = c.id
             WHERE c.user_id = :u GROUP BY c.id, c.name, c.server_name ORDER BY killed DESC, c.name',
            ['u' => $viewer->getId()],
        );

        return array_map(static fn (array $r) => [
            'name' => $r['name'],
            'server_name' => $r['server_name'],
            'killed' => (int) $r['killed'],
            'total' => $total,
        ], $rows);
    }
}
