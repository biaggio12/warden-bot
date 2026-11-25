<?php

namespace App\Tests\Functional;

use App\Entity\User;
use App\Entity\WardenSpawn;

final class AdminDeadClickApiTest extends ApiTestCase
{
    private function closed(User $reporter, ?User $closer, string $ago, int $closedAfterMinutes): void
    {
        $monster = $this->createMonster('Warden '.bin2hex(random_bytes(4)));
        $created = new \DateTimeImmutable($ago);
        $spawn = new WardenSpawn($monster, 'Monza', 'Somewhere', $reporter, createdAt: $created);
        $spawn->markKilled($closer, $created->modify("+$closedAfterMinutes minutes"));
        $this->em->persist($spawn);
        $this->em->flush();
    }

    public function testShowsWhoClosesWhoseReportsAndFlagsAPairThatLooksLikeFarming(): void
    {
        $moderator = $this->createUser('mod@example.com');
        $moderator->setModerator(true);
        $reporter = $this->createUser('reporter@example.com');
        $reporter->linkDiscord('500000000000000001', 'Reporter');
        $helper = $this->createUser('helper@example.com');
        $helper->linkDiscord('500000000000000002', 'Helper');
        $stranger = $this->createUser('stranger@example.com');
        $stranger->linkDiscord('500000000000000003', 'Stranger');
        $this->em->flush();

        for ($i = 1; $i <= 5; ++$i) {
            $this->closed($reporter, $helper, "-$i days", 1); // right away, every time
        }
        $this->closed($reporter, $stranger, '-1 day', 6);
        $this->closed($reporter, $reporter, '-2 days', 1); // own report: not a pair
        $this->closed($stranger, $helper, '-3 days', 5);
        $this->closed($reporter, $helper, '-60 days', 1); // outside the default 30 days
        [$token, $helperToken] = [$this->tokenFor($moderator), $this->tokenFor($helper)];

        $data = $this->requestJson('GET', '/api/v1/admin/dead-clicks', token: $token);

        self::assertResponseIsSuccessful();
        self::assertSame([
            ['Helper', 'Reporter', 5, 5, 1.0, 0.83, ['frequent', 'quick', 'one_closer']],
            ['Stranger', 'Reporter', 1, 0, 6.0, 0.17, []],
            ['Helper', 'Stranger', 1, 0, 5.0, 1.0, []],
        ], array_map(static fn (array $p): array => [$p['closer']['name'], $p['reporter']['name'], $p['closures'], $p['quick'], (float) $p['median_minutes'], (float) $p['share'], $p['flags']], $data['pairs']));

        $stranger = $this->requestJson('GET', '/api/v1/admin/dead-clicks?user_id='.$stranger->getId(), token: $token);
        self::assertCount(2, $stranger['pairs'], 'on either side');

        $from = urlencode((new \DateTimeImmutable('-90 days'))->format(\DATE_ATOM));
        $longer = $this->requestJson('GET', "/api/v1/admin/dead-clicks?from=$from", token: $token);
        self::assertSame(6, $longer['pairs'][0]['closures']);

        $this->requestJson('GET', '/api/v1/admin/dead-clicks', token: $helperToken);
        self::assertResponseStatusCodeSame(403);

        // The summary at the top of the Players tab counts the flagged pairs.
        $flags = $this->requestJson('GET', '/api/v1/admin/flags', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame(['days' => 30, 'dead_click_pairs' => 1, 'duel_pairs' => 0], $flags);
        $this->requestJson('GET', '/api/v1/admin/flags', token: $helperToken);
        self::assertResponseStatusCodeSame(403);
    }
}
