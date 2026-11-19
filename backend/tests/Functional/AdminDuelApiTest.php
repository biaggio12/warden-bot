<?php

namespace App\Tests\Functional;

use App\Entity\Duel;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;

final class AdminDuelApiTest extends ApiTestCase
{
    private const FARMER = '200000000000000001';
    private const FEEDER = '200000000000000002';

    private function moderator(): User
    {
        $moderator = $this->createUser('mod@example.com');
        $moderator->setModerator(true);
        $this->em->flush();

        return $moderator;
    }

    private function finishedDuel(User $a, User $b, string $startedAgo, int $aScore, int $bScore, int $stake = 5): Duel
    {
        $start = new \DateTimeImmutable($startedAgo);
        $duel = new Duel($a, $b, 15, $start->modify('-1 minute'), stake: $stake);
        $duel->accept($start);
        $duel->finish($aScore, $bScore);
        $this->em->persist($duel);

        return $duel;
    }

    public function testListsDuelsAndFlagsAPairThatKeepsMeeting(): void
    {
        $farmer = $this->createUser('farmer@example.com', self::FARMER);
        $farmer->linkDiscord(self::FARMER, 'Farmer');
        $feeder = $this->createUser('feeder@example.com', self::FEEDER);
        $feeder->linkDiscord(self::FEEDER, 'Feeder');
        foreach (['-1 day', '-2 days', '-3 days'] as $ago) {
            $this->finishedDuel($farmer, $feeder, $ago, 6, 0);
        }
        $this->em->flush();

        $data = $this->requestJson('GET', '/api/v1/admin/duels', token: $this->tokenFor($this->moderator()));

        self::assertResponseIsSuccessful();
        self::assertCount(3, $data['duels']);
        self::assertSame(['Farmer', 'Feeder', 5], [$data['duels'][0]['challenger']['name'], $data['duels'][0]['opponent']['name'], $data['duels'][0]['stake']]);
        self::assertSame('challenger', $data['duels'][0]['result']);

        self::assertCount(1, $data['pairs']);
        $pair = $data['pairs'][0];
        self::assertSame(['Farmer', 'Feeder'], [$pair['a']['name'], $pair['b']['name']]);
        self::assertSame([3, 3, 0, 0, 15], [$pair['duels'], $pair['a_wins'], $pair['b_wins'], $pair['draws'], $pair['stakes_to_a']]);
        self::assertSame(['repeated', 'one_sided'], $pair['flags']);
    }

    public function testShowsWhoConfirmedEachReportOfADuel(): void
    {
        $farmer = $this->createUser('farmer@example.com', self::FARMER);
        $farmer->linkDiscord(self::FARMER, 'Farmer');
        $feeder = $this->createUser('feeder@example.com', self::FEEDER);
        $feeder->linkDiscord(self::FEEDER, 'Feeder');
        $duel = $this->finishedDuel($farmer, $feeder, '-1 hour', 6, 0);

        // Confirmed only by the opponent's [OMW]: counts, but flagged.
        $spawn = new WardenSpawn($this->createMonster('Dragon', 'Dragons', 50), 'Monza', 'Somewhere', $farmer, 8, new \DateTimeImmutable('-55 minutes'));
        $this->em->persist($spawn);
        $presence = new WardenSpawnPresence($spawn, '123456789012', new \DateTimeImmutable());
        $presence->replace([self::FEEDER], [], new \DateTimeImmutable());
        $this->em->persist($presence);
        // Closed with [Dead] by someone outside the duel, but a duplicate of the report above: does not count.
        $witness = $this->createUser('witness@example.com', '200000000000000003');
        $witness->linkDiscord('200000000000000003', 'Witness');
        $dup = new WardenSpawn($spawn->getMonster(), 'Monza', 'Elsewhere', $farmer, 8, new \DateTimeImmutable('-54 minutes'));
        $dup->markKilled($witness, new \DateTimeImmutable('-50 minutes'));
        $this->em->persist($dup);
        // [Dead] clicked by the reporter himself: counts, but nobody else saw it.
        $own = new WardenSpawn($this->createMonster('Hydra', 'Reptiles', 15), 'Monza', 'Lair', $farmer, 8, new \DateTimeImmutable('-48 minutes'));
        $own->markKilled($farmer, new \DateTimeImmutable('-47 minutes'));
        $this->em->persist($own);
        $this->em->flush();

        $data = $this->requestJson('GET', \sprintf('/api/v1/admin/duels/%s', $duel->getId()), token: $this->tokenFor($this->moderator()));

        self::assertResponseIsSuccessful();
        self::assertSame($duel->getId()->toRfc4122(), $data['duel']['id']);
        [$first, $second, $third] = $data['reports'];
        self::assertSame([['type' => 'omw', 'user_id' => $feeder->getId(), 'name' => 'Feeder']], $first['confirmations']);
        self::assertTrue($first['confirmed_only_by_duel_players']);
        self::assertSame([true, false, 10], [$first['counted'], $first['duplicate'], $first['points']]);
        self::assertSame([['type' => 'dead', 'user_id' => $witness->getId(), 'name' => 'Witness']], $second['confirmations']);
        self::assertFalse($second['confirmed_only_by_duel_players']);
        self::assertSame([false, true, 0], [$second['counted'], $second['duplicate'], $second['points']]);
        self::assertSame([['type' => 'dead', 'user_id' => $farmer->getId(), 'name' => 'Farmer']], $third['confirmations']);
        self::assertTrue($third['confirmed_only_by_duel_players']);
        self::assertSame([true, 3], [$third['counted'], $third['points']]);
    }

    public function testPlayersCannotSeeIt(): void
    {
        $this->requestJson('GET', '/api/v1/admin/duels', token: $this->tokenFor($this->createUser()));
        self::assertResponseStatusCodeSame(403);
    }

    public function testFiltersByDatesAndPlayer(): void
    {
        $farmer = $this->createUser('farmer@example.com', self::FARMER);
        $farmer->linkDiscord(self::FARMER, 'Farmer');
        $feeder = $this->createUser('feeder@example.com', self::FEEDER);
        $feeder->linkDiscord(self::FEEDER, 'Feeder');
        $other = $this->createUser('other@example.com', '200000000000000009');
        $other->linkDiscord('200000000000000009', 'Other');
        // Three in four days, back in October, and one now with someone else.
        foreach (['2026-10-10 12:00', '2026-10-12 12:00', '2026-10-14 12:00'] as $at) {
            $this->finishedDuel($farmer, $feeder, $at, 6, 0);
        }
        $this->finishedDuel($other, $feeder, '-1 hour', 0, 3, stake: 0);
        $this->em->flush();
        $token = $this->tokenFor($this->moderator());

        $october = $this->requestJson('GET', '/api/v1/admin/duels?'.http_build_query(['from' => '2026-10-01T00:00:00+02:00', 'until' => '2026-11-01T00:00:00+01:00']), token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('2026-09-30T22:00:00Z', $october['from']);
        self::assertCount(3, $october['duels']);
        self::assertSame(['repeated', 'one_sided'], $october['pairs'][0]['flags'], 'three duels within seven days, all won by one side');

        // Only one of those days: the pair is no longer flagged.
        $oneDay = $this->requestJson('GET', '/api/v1/admin/duels?'.http_build_query(['from' => '2026-10-12T00:00:00Z', 'until' => '2026-10-13T00:00:00Z']), token: $token);
        self::assertCount(1, $oneDay['duels']);
        self::assertSame([], $oneDay['pairs'][0]['flags']);

        // The default window (last 30 days) for one player.
        $feederNow = $this->requestJson('GET', '/api/v1/admin/duels?user_id='.$other->getId(), token: $token);
        self::assertSame(['Other'], array_column(array_column($feederNow['duels'], 'challenger'), 'name'));
        self::assertSame([['Feeder', 'Other']], array_map(static fn (array $p): array => [$p['a']['name'], $p['b']['name']], $feederNow['pairs']));

        $this->requestJson('GET', '/api/v1/admin/duels?from=2026-11-10T00:00:00Z&until=2026-11-01T00:00:00Z', token: $token);
        self::assertResponseStatusCodeSame(400);
    }
}
