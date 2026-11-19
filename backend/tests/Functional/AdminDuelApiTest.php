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
        // Closed with [Dead], but a duplicate of the report above: does not count.
        $dup = new WardenSpawn($spawn->getMonster(), 'Monza', 'Elsewhere', $farmer, 8, new \DateTimeImmutable('-54 minutes'));
        $dup->markKilled();
        $this->em->persist($dup);
        $this->em->flush();

        $data = $this->requestJson('GET', \sprintf('/api/v1/admin/duels/%s', $duel->getId()), token: $this->tokenFor($this->moderator()));

        self::assertResponseIsSuccessful();
        self::assertSame($duel->getId()->toRfc4122(), $data['duel']['id']);
        [$first, $second] = $data['reports'];
        self::assertSame([['type' => 'omw', 'user_id' => $feeder->getId(), 'name' => 'Feeder']], $first['confirmations']);
        self::assertTrue($first['confirmed_by_opponent_only']);
        self::assertSame([true, false, 6], [$first['counted'], $first['duplicate'], $first['points']]);
        self::assertSame('dead', $second['confirmations'][0]['type']);
        self::assertFalse($second['confirmed_by_opponent_only']);
        self::assertSame([false, true, 0], [$second['counted'], $second['duplicate'], $second['points']]);
    }

    public function testPlayersCannotSeeIt(): void
    {
        $this->requestJson('GET', '/api/v1/admin/duels', token: $this->tokenFor($this->createUser()));
        self::assertResponseStatusCodeSame(403);
    }
}
