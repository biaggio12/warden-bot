<?php

namespace App\Service;

use App\Entity\WardenSpawn;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

/**
 * Which reports earn a point (and count in duels). A report is only a claim, so to keep
 * points from being farmed with made-up Wardens a report counts when:
 *
 *  - it is confirmed: someone clicked [Dead] on it (the report was closed as killed), someone
 *    else clicked [OMW] on one of its alerts, or someone else marked that monster as killed
 *    on a character on that world while the Warden was up;
 *  - it is the first report of that monster on that world: a second report of the same
 *    Warden within 10 minutes (from anyone) is a duplicate;
 *  - an admin has not deleted it (deleted reports are gone from the table).
 *
 * A counted report is worth points by the Warden's bestiary difficulty (see POINTS). A
 * player's points also go up and down with the stakes of the duels they won and lost.
 */
final readonly class ReportScoring
{
    /** Points for a counted report, by the monster's bestiary difficulty. */
    public const POINTS = [
        'Harmless' => 1,
        'Trivial' => 2,
        'Easy' => 3,
        'Medium' => 4,
        'Hard' => 10,
        'Challenging' => 25,
    ];
    /** A monster whose difficulty is unknown (charm points off the bestiary's scale). */
    private const DEFAULT_POINTS = 1;

    /** A late [Dead] click on the website still confirms the report. */
    private const KILL_CONFIRM_SLACK_MINUTES = 5;

    public function __construct(private Connection $db)
    {
    }

    /**
     * Points per player for reports made in [$from, $until).
     *
     * @param list<int>|null $userIds only these players (null: everyone)
     *
     * @return array<int, int> user id => points, only players with at least one point
     */
    public function pointsBetween(\DateTimeImmutable $from, \DateTimeImmutable $until, ?array $userIds = null): array
    {
        $rows = $this->counted(
            'SELECT s.reported_by_user_id AS user_id, SUM('.self::pointsSql('m.charm_points').') AS points',
            'GROUP BY s.reported_by_user_id',
            $from,
            $until,
            $userIds,
        );

        $points = [];
        foreach ($rows as $row) {
            $points[(int) $row['user_id']] = (int) $row['points'];
        }

        return $points;
    }

    /**
     * Ids of the reports in [$from, $until) that count (see the class doc), for the admins'
     * duel review: the same rules as the points.
     *
     * @param list<int>|null $userIds
     *
     * @return list<string>
     */
    public function countedSpawnIds(\DateTimeImmutable $from, \DateTimeImmutable $until, ?array $userIds = null): array
    {
        return array_map(static fn (array $row): string => (string) $row['id'], $this->counted('SELECT s.id', '', $from, $until, $userIds));
    }

    /**
     * The counted reports of [$from, $until) (only of `$userIds` when given), as `$select` ... `$tail`.
     *
     * @param list<int>|null $userIds
     *
     * @return list<array<string, mixed>>
     */
    private function counted(string $select, string $tail, \DateTimeImmutable $from, \DateTimeImmutable $until, ?array $userIds): array
    {
        if ([] === $userIds) {
            return [];
        }
        $params = [
            'from' => $from->format('Y-m-d H:i:s'),
            'until' => $until->format('Y-m-d H:i:s'),
            'slack' => self::KILL_CONFIRM_SLACK_MINUTES,
            'dup' => WardenSpawn::MAX_TTL_MINUTES,
        ];
        $types = [];
        $onlyUsers = '';
        if (null !== $userIds) {
            $onlyUsers = 'AND s.reported_by_user_id IN (:users)';
            $params['users'] = $userIds;
            $types['users'] = ArrayParameterType::INTEGER;
        }

        return $this->db->fetchAllAssociative(
            "$select
             FROM warden_spawns s
             JOIN users u ON u.id = s.reported_by_user_id
             JOIN monsters m ON m.id = s.monster_id
             WHERE s.created_at >= :from AND s.created_at < :until
               $onlyUsers
               AND (
                   s.status = 'KILLED'
                   OR EXISTS (
                       SELECT 1 FROM warden_spawn_presence p
                       CROSS JOIN LATERAL json_array_elements_text(p.on_my_way) AS omw(discord_user_id)
                       WHERE p.spawn_id = s.id AND omw.discord_user_id IS DISTINCT FROM u.discord_user_id
                   )
                   OR EXISTS (
                       SELECT 1 FROM character_killed_monsters k
                       JOIN characters c ON c.id = k.character_id
                       WHERE k.monster_id = s.monster_id
                         AND LOWER(c.server_name) = LOWER(s.server_name)
                         AND c.user_id <> s.reported_by_user_id
                         AND k.killed_at >= s.created_at
                         AND k.killed_at <= s.expires_at + make_interval(mins => CAST(:slack AS int))
                   )
               )
               AND NOT EXISTS (
                   SELECT 1 FROM warden_spawns e
                   WHERE e.monster_id = s.monster_id
                     AND e.server_name = s.server_name
                     AND e.id <> s.id
                     AND e.created_at > s.created_at - make_interval(mins => CAST(:dup AS int))
                     AND (e.created_at < s.created_at OR (e.created_at = s.created_at AND e.id < s.id))
               )
             $tail",
            $params,
            $types,
        );

    }

    /**
     * Points of one counted report, by difficulty. The database keeps the difficulty as the
     * charm points the bestiary gives for it (BestiaryData::CHARM_POINTS), one value each.
     */
    public static function pointsFor(int $charmPoints): int
    {
        $difficulty = array_search($charmPoints, BestiaryData::CHARM_POINTS, true);

        return false === $difficulty ? self::DEFAULT_POINTS : self::POINTS[$difficulty];
    }

    /** The same mapping in SQL: CASE <charm points> WHEN 1 THEN 1 ... END. */
    private static function pointsSql(string $charmPointsColumn): string
    {
        $cases = '';
        foreach (BestiaryData::CHARM_POINTS as $difficulty => $charmPoints) {
            $cases .= \sprintf(' WHEN %d THEN %d', $charmPoints, self::POINTS[$difficulty]);
        }

        return \sprintf('CASE %s%s ELSE %d END', $charmPointsColumn, $cases, self::DEFAULT_POINTS);
    }

    /**
     * Stakes won (+) and lost (-) in duels that ended in [$from, $until). A draw moves nothing.
     *
     * @param list<int>|null $userIds only these players (null: everyone)
     *
     * @return array<int, int> user id => net stakes, only players whose stakes moved
     */
    public function stakesBetween(\DateTimeImmutable $from, \DateTimeImmutable $until, ?array $userIds = null): array
    {
        if ([] === $userIds) {
            return [];
        }
        $params = ['from' => $from->format('Y-m-d H:i:s'), 'until' => $until->format('Y-m-d H:i:s')];
        $types = [];
        $onlyUsers = '';
        if (null !== $userIds) {
            $onlyUsers = 'WHERE t.user_id IN (:users)';
            $params['users'] = $userIds;
            $types['users'] = ArrayParameterType::INTEGER;
        }
        $rows = $this->db->fetchAllAssociative(
            "SELECT t.user_id, SUM(t.delta) AS delta FROM (
                 SELECT challenger_id AS user_id, SIGN(challenger_score - opponent_score) * stake AS delta
                 FROM duels WHERE status = 'FINISHED' AND stake > 0 AND ends_at >= :from AND ends_at < :until
                 UNION ALL
                 SELECT opponent_id, SIGN(opponent_score - challenger_score) * stake
                 FROM duels WHERE status = 'FINISHED' AND stake > 0 AND ends_at >= :from AND ends_at < :until
             ) t $onlyUsers GROUP BY t.user_id HAVING SUM(t.delta) <> 0",
            $params,
            $types,
        );

        $stakes = [];
        foreach ($rows as $row) {
            $stakes[(int) $row['user_id']] = (int) $row['delta'];
        }

        return $stakes;
    }

    /**
     * Points for reports plus duel stakes won and lost in [$from, $until).
     *
     * @param list<int>|null $userIds
     *
     * @return array<int, int> user id => points, players with any points or stakes
     */
    public function totalBetween(\DateTimeImmutable $from, \DateTimeImmutable $until, ?array $userIds = null): array
    {
        $total = $this->pointsBetween($from, $until, $userIds);
        foreach ($this->stakesBetween($from, $until, $userIds) as $userId => $delta) {
            $total[$userId] = ($total[$userId] ?? 0) + $delta;
        }

        return $total;
    }

    /** What a player can put at stake: all their points so far. */
    public function balanceOf(int $userId, \DateTimeImmutable $now): int
    {
        return $this->totalBetween(new \DateTimeImmutable('1970-01-01 00:00:00'), $now->modify('+1 second'), [$userId])[$userId] ?? 0;
    }

    /**
     * Every player with points in [$from, $until), best first; ties share a rank.
     *
     * @return list<array{user_id: int, points: int, rank: int}>
     */
    public function ranking(\DateTimeImmutable $from, \DateTimeImmutable $until): array
    {
        $points = $this->totalBetween($from, $until);
        uksort($points, static fn (int $a, int $b): int => [$points[$b], $a] <=> [$points[$a], $b]);

        $ranking = [];
        $rank = 0;
        $previous = null;
        foreach (array_keys($points) as $i => $userId) {
            if ($points[$userId] !== $previous) {
                $rank = $i + 1;
                $previous = $points[$userId];
            }
            $ranking[] = ['user_id' => $userId, 'points' => $points[$userId], 'rank' => $rank];
        }

        return $ranking;
    }
}
