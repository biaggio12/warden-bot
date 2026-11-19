<?php

namespace App\Tests\Integration;

use App\Entity\Duel;
use App\Entity\Monster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;
use App\Enum\DuelStatus;
use App\Message\DuelExpiredEvent;
use App\Message\DuelFinishedEvent;
use App\Message\ResolveDuels;
use App\MessageHandler\ResolveDuelsHandler;
use App\Service\ReportScoring;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;

final class ResolveDuelsHandlerTest extends KernelTestCase
{
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
    }

    private function user(string $email, string $discordUserId): User
    {
        $user = new User($email);
        $user->setPassword('not-used');
        $user->linkDiscord($discordUserId, strstr($email, '@', true));
        $this->em->persist($user);

        return $user;
    }

    private function confirmedSpawn(User $by, Monster $monster, \DateTimeImmutable $at, string $confirmedBy): void
    {
        $spawn = new WardenSpawn($monster, 'Monza', 'Somewhere', $by, 8, $at);
        $this->em->persist($spawn);
        $presence = new WardenSpawnPresence($spawn, (string) random_int(10_000_000, 99_999_999), $at);
        $presence->replace([$confirmedBy], [], $at);
        $this->em->persist($presence);
    }

    public function testScoresFinishedDuelsAndExpiresUnansweredChallenges(): void
    {
        $alice = $this->user('alice@example.com', '100000000000000001');
        $bob = $this->user('bob@example.com', '100000000000000002');
        $carol = $this->user('carol@example.com', '100000000000000003');
        $dave = $this->user('dave@example.com', '100000000000000004');
        $dragon = new Monster('Dragon', 'Dragons', 50);
        $hydra = new Monster('Hydra', 'Reptiles', 15);
        $this->em->persist($dragon);
        $this->em->persist($hydra);

        // Alice vs Bob: 30 min, started 2 h ago - over, grace passed.
        $start = new \DateTimeImmutable('-2 hours');
        $finished = new Duel($alice, $bob, 30, $start->modify('-1 minute'), stake: 5);
        $finished->accept($start);
        $this->em->persist($finished);
        $this->confirmedSpawn($alice, $dragon, $start->modify('+5 minutes'), '100000000000000003');
        $this->confirmedSpawn($alice, $hydra, $start->modify('+20 minutes'), '100000000000000002');
        $this->confirmedSpawn($bob, $dragon, $start->modify('+25 minutes'), '100000000000000001');
        // Before the start and after the end: neither counts.
        $this->confirmedSpawn($bob, $hydra, $start->modify('-30 minutes'), '100000000000000001');
        $this->confirmedSpawn($bob, $hydra, $start->modify('+40 minutes'), '100000000000000001');

        // Ended 5 min ago, but Carol's report from the duel is still up: wait for it to close.
        $recent = new Duel($carol, $dave, 15, new \DateTimeImmutable('-21 minutes'));
        $recent->accept(new \DateTimeImmutable('-20 minutes'));
        $this->em->persist($recent);
        $this->em->persist(new WardenSpawn($dragon, 'Monza', 'Somewhere', $carol, 8, new \DateTimeImmutable('-7 minutes')));

        // Ended a minute ago and neither player has a report up: the result comes at once.
        $gina = $this->user('gina@example.com', '100000000000000007');
        $hank = $this->user('hank@example.com', '100000000000000008');
        $quick = new Duel($gina, $hank, 15, new \DateTimeImmutable('-17 minutes'));
        $quick->accept(new \DateTimeImmutable('-16 minutes'));
        $this->em->persist($quick);

        $this->em->flush();

        // A challenge nobody answered.
        $eve = $this->user('eve@example.com', '100000000000000005');
        $frank = $this->user('frank@example.com', '100000000000000006');
        $unanswered = new Duel($eve, $frank, 60, new \DateTimeImmutable('-15 minutes'));
        $this->em->persist($unanswered);
        $this->em->flush();

        $result = static::getContainer()->get(ResolveDuelsHandler::class)(new ResolveDuels());

        self::assertSame(['expired' => 1, 'finished' => 2], $result);
        self::assertSame(DuelStatus::Finished, $finished->getStatus());
        // Alice: Dragon (Hard, 10) + Hydra (Easy, 3); Bob: Dragon (10).
        self::assertSame([13, 10], [$finished->getChallengerScore(), $finished->getOpponentScore()]);
        self::assertSame($alice, $finished->getWinner());
        self::assertSame(DuelStatus::Active, $recent->getStatus());
        self::assertSame(DuelStatus::Finished, $quick->getStatus());
        self::assertNull($quick->getWinner(), '0:0 is a draw');
        self::assertSame(DuelStatus::Expired, $unanswered->getStatus());

        /** @var InMemoryTransport $transport */
        $transport = static::getContainer()->get('messenger.transport.discord_events');
        $messages = array_map(static fn ($envelope) => $envelope->getMessage(), $transport->getSent());
        self::assertCount(3, $messages);
        $finishedEvent = array_values(array_filter($messages, static fn ($m) => $m instanceof DuelFinishedEvent && 5 === $m->stake))[0];
        self::assertSame('challenger', $finishedEvent->result);
        self::assertSame([13, 10], [$finishedEvent->challengerScore, $finishedEvent->opponentScore]);
        self::assertCount(1, array_filter($messages, static fn ($m) => $m instanceof DuelExpiredEvent));

        // Played for 5 points: Alice takes them from Bob. All-time report points: Alice 13; Bob 10 + two Easy Hydras outside the duel = 16.
        $scoring = static::getContainer()->get(ReportScoring::class);
        self::assertSame(18, $scoring->balanceOf((int) $alice->getId(), new \DateTimeImmutable()));
        self::assertSame(11, $scoring->balanceOf((int) $bob->getId(), new \DateTimeImmutable()));
        self::assertSame(5, $finishedEvent->stake);

        self::assertSame(['expired' => 0, 'finished' => 0], static::getContainer()->get(ResolveDuelsHandler::class)(new ResolveDuels()), 'nothing is resolved twice');
    }
}
