<?php

namespace App\Tests\Functional;

use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;

final class MyReportsApiTest extends ApiTestCase
{
    public function testExplainsThePointsOfEachOfMyReports(): void
    {
        $me = $this->createUser('me@example.com', '600000000000000001');
        $other = $this->createUser('other@example.com', '600000000000000002');
        $hard = $this->createMonster('Hard Warden', 'Giants', 50); // 10 points
        $easy = $this->createMonster('Easy Warden', 'Mammals', 15);
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));

        // Closed with [Dead]: counted (Easy, 3 points).
        $own = new WardenSpawn($easy, 'Monza', 'Own dead', $me, 8, $now->modify('-5 hours'));
        $own->markKilled($me, $now->modify('-299 minutes'));
        // Someone else was on the way: counted.
        $seen = new WardenSpawn($hard, 'Monza', 'Seen', $me, 8, $now->modify('-4 hours'));
        // The same Warden again a minute later: duplicate.
        $dup = new WardenSpawn($hard, 'Monza', 'Again', $me, 8, $now->modify('-239 minutes'));
        // Ran out, nobody came.
        $lonely = new WardenSpawn($easy, 'Antica', 'Lonely', $me, 8, $now->modify('-3 hours'));
        // Still up.
        $live = new WardenSpawn($easy, 'Secura', 'Live', $me, 8, $now->modify('-1 minute'));
        // Not mine; and one of mine from long ago, outside 7 days.
        $theirs = new WardenSpawn($easy, 'Monza', 'Theirs', $other, 8, $now->modify('-2 hours'));
        $old = new WardenSpawn($easy, 'Monza', 'Old', $me, 8, $now->modify('-20 days'));
        foreach ([$own, $seen, $dup, $lonely, $live, $theirs, $old] as $spawn) {
            $this->em->persist($spawn);
        }
        $presence = new WardenSpawnPresence($seen, '123456789012', $now);
        $presence->replace(['600000000000000002'], [], $now);
        $this->em->persist($presence);
        $this->em->flush();
        $token = $this->tokenFor($me);

        $data = $this->requestJson('GET', '/api/v1/me/reports?period=7d', token: $token);

        self::assertResponseIsSuccessful();
        self::assertSame(13, $data['points']);
        self::assertSame(['counted' => 2, 'waiting' => 1, 'unconfirmed' => 1, 'duplicate' => 1], $data['outcomes']);
        self::assertSame(
            [['Live', 'waiting', 0], ['Lonely', 'unconfirmed', 0], ['Again', 'duplicate', 0], ['Seen', 'counted', 10], ['Own dead', 'counted', 3]],
            array_map(static fn (array $r): array => [$r['location'], $r['outcome'], $r['points']], $data['reports']),
        );

        $all = $this->requestJson('GET', '/api/v1/me/reports?period=all', token: $token);
        self::assertSame(6, $all['total']);

        $this->requestJson('GET', '/api/v1/me/reports?period=year', token: $token);
        self::assertResponseStatusCodeSame(400);
    }
}
