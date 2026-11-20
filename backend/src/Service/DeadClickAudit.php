<?php

namespace App\Service;

use App\Http\DateWindow;
use App\Http\Json;
use Doctrine\DBAL\Connection;

/**
 * Who closes whose reports with [Dead], for the staff. A [Dead] click confirms the report, so
 * it earns the reporter points: one player who keeps closing another's reports, or closes
 * them right after they are made, may be helping them farm points.
 *
 * Only closures of someone else's report count; reports whose closer or reporter is gone
 * are left out.
 */
final readonly class DeadClickAudit
{
    /** A closure this soon after the report is "quick": hardly time to walk there. */
    public const QUICK_MINUTES = 2;
    /** Flag: this many closures of one reporter's reports by the same player. */
    public const FREQUENT = 5;
    /** The other flags need at least this many closures, so one odd click is not flagged. */
    public const MIN_FOR_SHARE = 3;
    /** Flag: this share of the reporter's closed reports (closed by others) were closed by this player. */
    public const ONE_CLOSER_SHARE = 0.8;
    /** Most pairs returned. */
    public const LIMIT = 100;

    public function __construct(
        private Connection $db,
        private PlayerNames $names,
    ) {
    }

    /**
     * Pairs with the most closures first. `$userId` keeps the pairs that player is in, on either side.
     *
     * @return list<array{
     *     closer: array{id: int, name: string}, reporter: array{id: int, name: string},
     *     closures: int, quick: int, median_minutes: float, share: float, last_at: string,
     *     flags: list<'frequent'|'quick'|'one_closer'>
     * }>
     */
    public function pairs(DateWindow $window, ?int $userId = null): array
    {
        [$where, $params] = $window->sql('s.created_at');
        $where[] = "s.status = 'KILLED'";
        $where[] = 's.killed_by_user_id IS NOT NULL AND s.killed_at IS NOT NULL';
        $where[] = 's.reported_by_user_id IS NOT NULL';
        $where[] = 's.killed_by_user_id <> s.reported_by_user_id';
        $closed = 'SELECT s.* FROM warden_spawns s WHERE '.implode(' AND ', $where);

        $rows = $this->db->fetchAllAssociative(
            "WITH closed AS ($closed),
                  per_reporter AS (SELECT reported_by_user_id, COUNT(*) AS closures FROM closed GROUP BY reported_by_user_id)
             SELECT c.killed_by_user_id AS closer, c.reported_by_user_id AS reporter,
                    COUNT(*) AS closures,
                    COUNT(*) FILTER (WHERE c.killed_at < c.created_at + make_interval(mins => CAST(:quick AS int))) AS quick,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.killed_at - c.created_at)) / 60) AS median_minutes,
                    MAX(r.closures) AS reporter_closures,
                    MAX(c.killed_at) AS last_at
             FROM closed c JOIN per_reporter r ON r.reported_by_user_id = c.reported_by_user_id
             WHERE CAST(:user AS INT) IS NULL OR c.killed_by_user_id = :user OR c.reported_by_user_id = :user
             GROUP BY c.killed_by_user_id, c.reported_by_user_id
             ORDER BY closures DESC, last_at DESC
             LIMIT ".self::LIMIT,
            $params + ['quick' => self::QUICK_MINUTES, 'user' => $userId],
        );

        $names = $this->names->of([...array_column($rows, 'closer'), ...array_column($rows, 'reporter')]);

        return array_map(static function (array $r) use ($names): array {
            $closures = (int) $r['closures'];
            $quick = (int) $r['quick'];
            $share = $closures / max(1, (int) $r['reporter_closures']);
            $flags = [];
            if ($closures >= self::FREQUENT) {
                $flags[] = 'frequent';
            }
            if ($closures >= self::MIN_FOR_SHARE && $quick * 2 >= $closures) {
                $flags[] = 'quick';
            }
            if ($closures >= self::MIN_FOR_SHARE && $share >= self::ONE_CLOSER_SHARE) {
                $flags[] = 'one_closer';
            }

            return [
                'closer' => ['id' => (int) $r['closer'], 'name' => $names[(int) $r['closer']]],
                'reporter' => ['id' => (int) $r['reporter'], 'name' => $names[(int) $r['reporter']]],
                'closures' => $closures,
                'quick' => $quick,
                'median_minutes' => round((float) $r['median_minutes'], 1),
                'share' => round($share, 2),
                'last_at' => Json::date(new \DateTimeImmutable((string) $r['last_at'], new \DateTimeZone('UTC'))),
                'flags' => $flags,
            ];
        }, $rows);
    }
}
