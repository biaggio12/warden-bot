<?php

namespace App\Tests\Functional;

use App\Entity\Duel;
use App\Entity\Monster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;
use Doctrine\ORM\EntityManagerInterface;

final class DuelApiTest extends ApiTestCase
{
    private const ME = '111111111111111111';
    private const RIVAL = '222222222222222222';
    private const HELPER = '333333333333333333';

    private function asBot(string $discordUserId): array
    {
        return ['X-Discord-User-Id' => $discordUserId];
    }

    public function testChallengeAcceptAndLiveScore(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $this->createUser('rival@example.com', self::RIVAL);

        $duel = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 30, 'discord_channel_id' => '99999999999'], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(201);
        self::assertSame('pending', $duel['status']);
        self::assertTrue($duel['challenger']['is_you']);
        self::assertNull($duel['starts_at']);

        $this->requestJson('POST', \sprintf('/api/v1/duels/%s/accept', $duel['id']), null, self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(403, 'the challenger cannot accept their own challenge');

        $accepted = $this->requestJson('POST', \sprintf('/api/v1/duels/%s/accept', $duel['id']), null, self::BOT_TOKEN, $this->asBot(self::RIVAL));
        self::assertResponseIsSuccessful();
        self::assertSame('active', $accepted['status']);
        self::assertSame([0, 0], [$accepted['challenger']['score'], $accepted['opponent']['score']]);

        // A confirmed report counts at once. (The requests rebooted the kernel: fresh entity manager.)
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        $me = $this->em->find(User::class, $me->getId());
        $spawn = new WardenSpawn($this->createMonster(), 'Monza', 'Dragon Lair', $me);
        $this->em->persist($spawn);
        $presence = new WardenSpawnPresence($spawn, '123456789012', new \DateTimeImmutable());
        $presence->replace([self::RIVAL], [], new \DateTimeImmutable());
        $this->em->persist($presence);
        $this->em->flush();

        $list = $this->requestJson('GET', '/api/v1/duels', token: $this->tokenFor($me));
        self::assertSame($duel['id'], $list['current']['id']);
        self::assertSame(6, $list['current']['challenger']['score'], 'a Hard Warden (50 charm points) is worth 6');
        self::assertSame(['won' => 0, 'lost' => 0, 'drawn' => 0], $list['record']);
    }

    public function testOneDuelAtATime(): void
    {
        $this->createUser('me@example.com', self::ME);
        $this->createUser('rival@example.com', self::RIVAL);
        $this->createUser('helper@example.com', self::HELPER);

        $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 15], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(201);

        $busy = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::HELPER, 'minutes' => 15], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('duel_busy', $busy['code']);

        $opponentBusy = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 15], self::BOT_TOKEN, $this->asBot(self::HELPER));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('opponent_busy', $opponentBusy['code']);
    }

    public function testDeclineAndValidation(): void
    {
        $this->createUser('me@example.com', self::ME);
        $this->createUser('rival@example.com', self::RIVAL);

        $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::ME, 'minutes' => 15], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(422);

        $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => '444444444444444444', 'minutes' => 15], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(404, 'opponent without a linked account');

        $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 7], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(422, 'unsupported duration');

        $duel = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 60], self::BOT_TOKEN, $this->asBot(self::ME));
        $declined = $this->requestJson('POST', \sprintf('/api/v1/duels/%s/decline', $duel['id']), null, self::BOT_TOKEN, $this->asBot(self::RIVAL));
        self::assertSame('declined', $declined['status']);

        $this->requestJson('POST', \sprintf('/api/v1/duels/%s/accept', $duel['id']), null, self::BOT_TOKEN, $this->asBot(self::RIVAL));
        self::assertResponseStatusCodeSame(409);

        // Declined: both are free for a new one.
        $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::ME, 'minutes' => 15], self::BOT_TOKEN, $this->asBot(self::RIVAL));
        self::assertResponseStatusCodeSame(201);
    }

    public function testExpiredChallengeCannotBeAccepted(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $rival = $this->createUser('rival@example.com', self::RIVAL);
        $duel = new Duel($me, $rival, 30, new \DateTimeImmutable('-11 minutes'));
        $this->em->persist($duel);
        $this->em->flush();

        $this->requestJson('POST', \sprintf('/api/v1/duels/%s/accept', $duel->getId()), null, self::BOT_TOKEN, $this->asBot(self::RIVAL));
        self::assertResponseStatusCodeSame(409);
    }

    public function testBotAttachesItsMessage(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $rival = $this->createUser('rival@example.com', self::RIVAL);
        $duel = new Duel($me, $rival, 30, new \DateTimeImmutable());
        $this->em->persist($duel);
        $this->em->flush();

        $data = $this->requestJson('PUT', \sprintf('/api/v1/internal/duels/%s/message', $duel->getId()), ['channel_id' => '55555555555', 'message_id' => '66666666666'], self::BOT_TOKEN);
        self::assertResponseIsSuccessful();
        self::assertSame(['55555555555', '66666666666'], [$data['discord_channel_id'], $data['discord_message_id']]);

        $this->requestJson('PUT', \sprintf('/api/v1/internal/duels/%s/message', $duel->getId()), ['channel_id' => '55555555555', 'message_id' => '66666666666'], $this->tokenFor($me));
        self::assertResponseStatusCodeSame(403, 'players cannot use internal endpoints');
    }

    public function testPointsCountOnlyConfirmedFirstReports(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $me->linkDiscord(self::ME, 'Me');
        $rival = $this->createUser('rival@example.com', self::RIVAL);
        $rival->linkDiscord(self::RIVAL, 'Rival');
        $dragon = $this->createMonster('Dragon', 'Dragons', 50);
        $hydra = $this->createMonster('Hydra', 'Reptiles', 100);

        $confirm = function (WardenSpawn $spawn, array $onMyWay): void {
            $presence = new WardenSpawnPresence($spawn, (string) random_int(10_000_000, 99_999_999), new \DateTimeImmutable());
            $presence->replace($onMyWay, [], new \DateTimeImmutable());
            $this->em->persist($presence);
        };
        $spawn = function (User $by, Monster $monster, string $ago): WardenSpawn {
            $spawn = new WardenSpawn($monster, 'Monza', 'Somewhere', $by, 8, new \DateTimeImmutable($ago));
            $this->em->persist($spawn);

            return $spawn;
        };

        // Confirmed by the rival: counts.
        $confirm($spawn($me, $dragon, '-2 hours'), [self::RIVAL]);
        // Only the reporter on [OMW]: does not count.
        $confirm($spawn($me, $hydra, '-3 hours'), [self::ME]);
        // Not confirmed at all: does not count.
        $spawn($me, $hydra, '-5 hours');
        // The rival reports the same Dragon 2 min after me: a duplicate, even though confirmed.
        $confirm($spawn($rival, $dragon, '-118 minutes'), [self::ME]);
        // The rival's own Hydra, confirmed: counts.
        $confirm($spawn($rival, $hydra, '-1 hour'), [self::ME]);
        $this->em->flush();

        $points = $this->requestJson('GET', '/api/v1/points?period=7d', token: $this->tokenFor($me));
        self::assertResponseIsSuccessful();
        self::assertSame(6, $points['points'], 'Dragon: Hard, 6 points');
        self::assertSame(2, $points['rank']);
        self::assertSame(2, $points['players']);
        self::assertSame([['rank' => 1, 'player' => 'Rival', 'points' => 10, 'is_you' => false], ['rank' => 2, 'player' => 'Me', 'points' => 6, 'is_you' => true]], $points['top'], 'Hydra: Challenging, 10 points');

        $stats = $this->requestJson('GET', '/api/v1/stats?period=7d', token: $this->tokenFor($me));
        self::assertSame(6, $stats['you']['points']);
        self::assertSame([10, 6], array_column($stats['points_leaderboard'], 'points'));
    }

    public function testDeadClickConfirmsTheReport(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $spawn = new WardenSpawn($this->createMonster('Dragon', 'Dragons', 25), 'Monza', 'Somewhere', $me, 8, new \DateTimeImmutable('-1 hour'));
        $spawn->markKilled();
        $this->em->persist($spawn);
        $this->em->flush();

        $points = $this->requestJson('GET', '/api/v1/points?period=7d', token: $this->tokenFor($me));
        self::assertSame(4, $points['points'], 'closed with [Dead], even by the reporter: Medium, 4 points');
    }

    public function testPlayingForPoints(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $rival = $this->createUser('rival@example.com', self::RIVAL);
        foreach ([[$me, 'Dragon', 50], [$rival, 'Hydra', 25]] as [$by, $name, $charm]) {
            $spawn = new WardenSpawn($this->createMonster($name, 'X', $charm), 'Monza', 'Somewhere', $by, 8, new \DateTimeImmutable('-1 hour'));
            $spawn->markKilled();
            $this->em->persist($spawn);
        }
        $this->em->flush();
        // Me: 6 points, Rival: 4.

        $tooMuch = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 15, 'stake' => 7], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(422);
        self::assertSame('stake_too_high', $tooMuch['code']);

        $rivalShort = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 15, 'stake' => 5], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(422);
        self::assertSame('opponent_stake_too_high', $rivalShort['code']);

        $duel = $this->requestJson('POST', '/api/v1/duels', ['opponent_discord_user_id' => self::RIVAL, 'minutes' => 15, 'stake' => 4], self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseStatusCodeSame(201);
        self::assertSame(4, $duel['stake']);

        $accepted = $this->requestJson('POST', \sprintf('/api/v1/duels/%s/accept', $duel['id']), null, self::BOT_TOKEN, $this->asBot(self::RIVAL));
        self::assertResponseIsSuccessful();
        self::assertSame(4, $accepted['stake']);
    }

    public function testDeadClickPostsTheResultOfAFinishedDuelAtOnce(): void
    {
        $me = $this->createUser('me@example.com', self::ME);
        $rival = $this->createUser('rival@example.com', self::RIVAL);
        $duel = new Duel($me, $rival, 15, new \DateTimeImmutable('-17 minutes'));
        $duel->accept(new \DateTimeImmutable('-16 minutes'));
        $this->em->persist($duel);
        // Reported during the duel, still up after its end.
        $spawn = new WardenSpawn($this->createMonster('Dragon', 'Dragons', 50), 'Monza', 'Somewhere', $me, 8, new \DateTimeImmutable('-3 minutes'));
        $this->em->persist($spawn);
        $this->em->flush();

        $this->requestJson('POST', \sprintf('/api/v1/warden-spawns/%s/kill', $spawn->getId()), null, self::BOT_TOKEN, $this->asBot(self::ME));
        self::assertResponseIsSuccessful();

        // Who clicked [Dead] is kept, for the staff's duel review.
        $killedBy = static::getContainer()->get(\Doctrine\DBAL\Connection::class)->fetchAssociative('SELECT killed_by_user_id, killed_at FROM warden_spawns WHERE id = :id', ['id' => $spawn->getId()->toRfc4122()]);
        self::assertSame($me->getId(), (int) $killedBy['killed_by_user_id']);
        self::assertNotNull($killedBy['killed_at']);

        $data = $this->requestJson('GET', \sprintf('/api/v1/duels/%s', $duel->getId()), token: $this->tokenFor($me));
        self::assertSame('finished', $data['status']);
        self::assertSame('challenger', $data['result']);
        self::assertSame(6, $data['challenger']['score']);
    }
}
