<?php

namespace App\Service;

use App\Entity\Duel;
use App\Entity\WardenSpawn;
use App\Http\Json;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;

/**
 * Duels for the staff's Players tab, to spot points being farmed: who challenged whom, the
 * pairs that keep meeting, and for one duel every report with who confirmed it.
 */
final readonly class DuelAudit
{
    public const RECENT = 100;
    /** Pairs are summed up over this many days. */
    public const PAIR_DAYS = 30;
    /** The same two players this many times within REPEAT_DAYS is flagged. */
    public const REPEAT_COUNT = 3;
    public const REPEAT_DAYS = 7;

    public function __construct(
        private Connection $db,
        private ReportScoring $scoring,
        private ClockInterface $clock,
    ) {
    }

    /**
     * @return array{duels: list<array<string, mixed>>, pairs: list<array<string, mixed>>}
     */
    public function overview(): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT d.*, ca.email AS c_email, ca.discord_username AS c_discord, oa.email AS o_email, oa.discord_username AS o_discord
             FROM duels d JOIN users ca ON ca.id = d.challenger_id JOIN users oa ON oa.id = d.opponent_id
             ORDER BY d.created_at DESC, d.id DESC LIMIT '.self::RECENT,
        );

        return [
            'duels' => array_map(self::duel(...), $rows),
            'pairs' => $this->pairs(),
        ];
    }

    /**
     * One duel and every report of its two players made while it ran: whether it counted,
     * who confirmed it, and whether it duplicated an earlier report.
     *
     * @return array{duel: array<string, mixed>, reports: list<array<string, mixed>>}|null
     */
    public function details(string $duelId): ?array
    {
        $row = $this->db->fetchAssociative(
            'SELECT d.*, ca.email AS c_email, ca.discord_username AS c_discord, oa.email AS o_email, oa.discord_username AS o_discord
             FROM duels d JOIN users ca ON ca.id = d.challenger_id JOIN users oa ON oa.id = d.opponent_id
             WHERE d.id = :id',
            ['id' => $duelId],
        );
        if (false === $row) {
            return null;
        }
        if (null === $row['starts_at']) {
            return ['duel' => self::duel($row), 'reports' => []];
        }

        $from = new \DateTimeImmutable($row['starts_at']);
        $until = new \DateTimeImmutable($row['ends_at']);
        $players = [(int) $row['challenger_id'], (int) $row['opponent_id']];
        $counted = array_flip($this->scoring->countedSpawnIds($from, $until, $players));

        $spawns = $this->db->fetchAllAssociative(
            "SELECT s.id, s.reported_by_user_id, s.monster_id, s.server_name, s.status, s.created_at, s.expires_at,
                    m.name AS monster, m.charm_points, u.discord_user_id AS reporter_discord_id,
                    EXISTS (
                        SELECT 1 FROM warden_spawns e
                        WHERE e.monster_id = s.monster_id AND e.server_name = s.server_name AND e.id <> s.id
                          AND e.created_at > s.created_at - make_interval(mins => CAST(:dup AS int))
                          AND (e.created_at < s.created_at OR (e.created_at = s.created_at AND e.id < s.id))
                    ) AS duplicate
             FROM warden_spawns s JOIN monsters m ON m.id = s.monster_id JOIN users u ON u.id = s.reported_by_user_id
             WHERE s.reported_by_user_id IN (:players) AND s.created_at >= :from AND s.created_at < :until
             ORDER BY s.created_at",
            ['players' => $players, 'from' => $from->format('Y-m-d H:i:s'), 'until' => $until->format('Y-m-d H:i:s'), 'dup' => WardenSpawn::MAX_TTL_MINUTES],
            ['players' => ArrayParameterType::INTEGER],
        );

        $names = [(int) $row['challenger_id'] => self::name($row['c_discord'], $row['c_email'], (int) $row['challenger_id']),
            (int) $row['opponent_id'] => self::name($row['o_discord'], $row['o_email'], (int) $row['opponent_id'])];

        return [
            'duel' => self::duel($row),
            'reports' => array_map(function (array $spawn) use ($counted, $names, $players): array {
                $confirmations = $this->confirmations($spawn);

                return [
                    'id' => $spawn['id'],
                    'reporter' => ['id' => (int) $spawn['reported_by_user_id'], 'name' => $names[(int) $spawn['reported_by_user_id']]],
                    'monster' => $spawn['monster'],
                    'server_name' => $spawn['server_name'],
                    'status' => strtolower($spawn['status']),
                    'created_at' => Json::date(new \DateTimeImmutable($spawn['created_at'])),
                    'confirmations' => $confirmations,
                    // Confirmed only by the other player of the duel: worth a closer look.
                    'confirmed_by_opponent_only' => [] !== $confirmations && [] === array_filter(
                        $confirmations,
                        static fn (array $c): bool => 'dead' === $c['type'] || !\in_array($c['user_id'], $players, true),
                    ),
                    'duplicate' => (bool) $spawn['duplicate'],
                    'counted' => isset($counted[$spawn['id']]),
                    'points' => isset($counted[$spawn['id']]) ? ReportScoring::pointsFor((int) $spawn['charm_points']) : 0,
                ];
            }, $spawns),
        ];
    }

    /**
     * Who confirmed one report: [Dead] (the report was closed as killed), [OMW] clicks of
     * other players, and other players marking the monster killed while it was up.
     *
     * @param array<string, mixed> $spawn
     *
     * @return list<array{type: string, user_id: ?int, name: ?string}>
     */
    private function confirmations(array $spawn): array
    {
        $confirmations = 'KILLED' === $spawn['status'] ? [['type' => 'dead', 'user_id' => null, 'name' => null]] : [];

        $omw = $this->db->fetchAllAssociative(
            'SELECT DISTINCT u.id, u.email, u.discord_username, omw.discord_user_id
             FROM warden_spawn_presence p
             CROSS JOIN LATERAL json_array_elements_text(p.on_my_way) AS omw(discord_user_id)
             LEFT JOIN users u ON u.discord_user_id = omw.discord_user_id
             WHERE p.spawn_id = :spawn AND omw.discord_user_id IS DISTINCT FROM :reporter',
            ['spawn' => $spawn['id'], 'reporter' => $spawn['reporter_discord_id']],
        );
        foreach ($omw as $r) {
            $confirmations[] = [
                'type' => 'omw',
                'user_id' => null === $r['id'] ? null : (int) $r['id'],
                'name' => null === $r['id'] ? 'Discord '.$r['discord_user_id'] : self::name($r['discord_username'], $r['email'], (int) $r['id']),
            ];
        }

        $kills = $this->db->fetchAllAssociative(
            "SELECT DISTINCT u.id, u.email, u.discord_username
             FROM character_killed_monsters k JOIN characters c ON c.id = k.character_id JOIN users u ON u.id = c.user_id
             WHERE k.monster_id = :monster AND LOWER(c.server_name) = LOWER(:server) AND c.user_id <> :reporter
               AND k.killed_at >= :created AND k.killed_at <= CAST(:expires AS timestamp) + interval '5 minutes'",
            ['monster' => $spawn['monster_id'], 'server' => $spawn['server_name'], 'reporter' => $spawn['reported_by_user_id'], 'created' => $spawn['created_at'], 'expires' => $spawn['expires_at']],
        );
        foreach ($kills as $r) {
            $confirmations[] = ['type' => 'kill', 'user_id' => (int) $r['id'], 'name' => self::name($r['discord_username'], $r['email'], (int) $r['id'])];
        }

        return $confirmations;
    }

    /**
     * Pairs that played finished duels in the last PAIR_DAYS days, flagged ones first.
     *
     * @return list<array<string, mixed>>
     */
    private function pairs(): array
    {
        $now = $this->clock->now();
        $rows = $this->db->fetchAllAssociative(
            "SELECT LEAST(d.challenger_id, d.opponent_id) AS a_id, GREATEST(d.challenger_id, d.opponent_id) AS b_id,
                    COUNT(*) AS duels,
                    COUNT(*) FILTER (WHERE d.ends_at >= :repeat_since) AS recent,
                    COUNT(*) FILTER (WHERE d.challenger_score <> d.opponent_score
                        AND (CASE WHEN d.challenger_score > d.opponent_score THEN d.challenger_id ELSE d.opponent_id END) = LEAST(d.challenger_id, d.opponent_id)) AS a_wins,
                    COUNT(*) FILTER (WHERE d.challenger_score <> d.opponent_score
                        AND (CASE WHEN d.challenger_score > d.opponent_score THEN d.challenger_id ELSE d.opponent_id END) = GREATEST(d.challenger_id, d.opponent_id)) AS b_wins,
                    SUM(CASE WHEN d.challenger_score = d.opponent_score THEN 0
                             WHEN (CASE WHEN d.challenger_score > d.opponent_score THEN d.challenger_id ELSE d.opponent_id END) = LEAST(d.challenger_id, d.opponent_id) THEN d.stake
                             ELSE -d.stake END) AS stakes_to_a,
                    MAX(d.ends_at) AS last_at
             FROM duels d
             WHERE d.status = 'FINISHED' AND d.ends_at >= :since
             GROUP BY 1, 2",
            [
                'since' => $now->modify(\sprintf('-%d days', self::PAIR_DAYS))->format('Y-m-d H:i:s'),
                'repeat_since' => $now->modify(\sprintf('-%d days', self::REPEAT_DAYS))->format('Y-m-d H:i:s'),
            ],
        );
        if ([] === $rows) {
            return [];
        }
        $names = $this->names(array_merge(array_column($rows, 'a_id'), array_column($rows, 'b_id')));

        $pairs = array_map(static function (array $r) use ($names): array {
            $duels = (int) $r['duels'];
            $flags = [];
            if ((int) $r['recent'] >= self::REPEAT_COUNT) {
                $flags[] = 'repeated';
            }
            if ($duels >= self::REPEAT_COUNT && 0 !== (int) $r['stakes_to_a'] && (0 === (int) $r['a_wins'] || 0 === (int) $r['b_wins'])) {
                $flags[] = 'one_sided';
            }

            return [
                'a' => ['id' => (int) $r['a_id'], 'name' => $names[(int) $r['a_id']]],
                'b' => ['id' => (int) $r['b_id'], 'name' => $names[(int) $r['b_id']]],
                'duels' => $duels,
                'a_wins' => (int) $r['a_wins'],
                'b_wins' => (int) $r['b_wins'],
                'draws' => $duels - (int) $r['a_wins'] - (int) $r['b_wins'],
                'stakes_to_a' => (int) $r['stakes_to_a'],
                'last_at' => Json::date(new \DateTimeImmutable($r['last_at'])),
                'flags' => $flags,
            ];
        }, $rows);
        usort($pairs, static fn (array $x, array $y): int => [\count($y['flags']), $y['duels'], $y['last_at']] <=> [\count($x['flags']), $x['duels'], $x['last_at']]);

        return $pairs;
    }

    /**
     * @param list<int|string> $ids
     *
     * @return array<int, string>
     */
    private function names(array $ids): array
    {
        $names = [];
        foreach ($this->db->fetchAllAssociative(
            'SELECT id, email, discord_username FROM users WHERE id IN (:ids)',
            ['ids' => array_map('intval', array_unique($ids))],
            ['ids' => ArrayParameterType::INTEGER],
        ) as $r) {
            $names[(int) $r['id']] = self::name($r['discord_username'], $r['email'], (int) $r['id']);
        }

        return $names;
    }

    /** Staff see who an account is: the Discord name, else the e-mail. */
    private static function name(?string $discord, ?string $email, int $id): string
    {
        return $discord ?: ($email ?: 'account #'.$id);
    }

    /**
     * @param array<string, mixed> $r a duels row joined with both players
     *
     * @return array<string, mixed>
     */
    private static function duel(array $r): array
    {
        $date = static fn (?string $value): ?string => null === $value ? null : Json::date(new \DateTimeImmutable($value));
        $finished = 'FINISHED' === $r['status'];
        $cs = null === $r['challenger_score'] ? null : (int) $r['challenger_score'];
        $os = null === $r['opponent_score'] ? null : (int) $r['opponent_score'];

        return [
            'id' => $r['id'],
            'status' => strtolower($r['status']),
            'minutes' => (int) $r['duration_minutes'],
            'stake' => (int) $r['stake'],
            'created_at' => $date($r['created_at']),
            'starts_at' => $date($r['starts_at']),
            'ends_at' => $date($r['ends_at']),
            'challenger' => ['id' => (int) $r['challenger_id'], 'name' => self::name($r['c_discord'], $r['c_email'], (int) $r['challenger_id']), 'score' => $cs],
            'opponent' => ['id' => (int) $r['opponent_id'], 'name' => self::name($r['o_discord'], $r['o_email'], (int) $r['opponent_id']), 'score' => $os],
            'result' => !$finished ? null : ($cs === $os ? 'draw' : ($cs > $os ? 'challenger' : 'opponent')),
        ];
    }
}
