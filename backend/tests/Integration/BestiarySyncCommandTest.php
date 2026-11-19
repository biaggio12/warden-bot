<?php

namespace App\Tests\Integration;

use App\Entity\Character;
use App\Entity\CharacterKilledMonster;
use App\Entity\Monster;
use App\Entity\User;
use App\Service\BestiaryData;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;

final class BestiarySyncCommandTest extends KernelTestCase
{
    public function testAddsFixesAndRemovesWithoutTouchingUsedMonsters(): void
    {
        $em = static::getContainer()->get(EntityManagerInterface::class);

        $wrongClass = new Monster('Dragon', 'Dragons', 1);
        $obsoleteUnused = new Monster('Black Knight', 'Humans', 50);
        $obsoleteUsed = new Monster('Old Thing', 'Misc', 5);
        $user = new User('player@example.com');
        $user->setPassword('x');
        $character = new Character($user, 'Sir Tester', 'Monza');
        foreach ([$wrongClass, $obsoleteUnused, $obsoleteUsed, $user, $character] as $entity) {
            $em->persist($entity);
        }
        $em->persist(new CharacterKilledMonster($character, $wrongClass));
        $em->persist(new CharacterKilledMonster($character, $obsoleteUsed));
        $em->flush();
        $dragonId = $wrongClass->getId();

        $file = tempnam(sys_get_temp_dir(), 'bestiary');
        file_put_contents($file, json_encode([
            ['name' => 'Dragon', 'class' => 'Dragon', 'difficulty' => 'Medium', 'image' => 'https://example.test/Dragon.gif'],
            ['name' => 'Hydra', 'class' => 'Dragon', 'difficulty' => 'Hard'],
        ]));

        $tester = new CommandTester((new Application(static::$kernel))->find('app:bestiary:sync'));
        $tester->execute(['--file' => $file]);
        unlink($file);

        $tester->assertCommandIsSuccessful();
        $em->clear();
        $repository = $em->getRepository(Monster::class);

        $dragon = $repository->findOneBy(['name' => 'Dragon']);
        self::assertSame($dragonId, $dragon->getId(), 'existing monsters keep their id, so kills stay attached');
        self::assertSame(['Dragon', 25, 'https://example.test/Dragon.gif'], [$dragon->getCategory(), $dragon->getCharmPoints(), $dragon->getImageUrl()]);
        self::assertNotNull($repository->findOneBy(['name' => 'Hydra']));
        self::assertNull($repository->findOneBy(['name' => 'Black Knight']));
        self::assertNotNull($repository->findOneBy(['name' => 'Old Thing']), 'monsters with kills are kept');
        self::assertSame(2, $em->getRepository(CharacterKilledMonster::class)->count([]));
        self::assertStringContainsString('Old Thing', $tester->getDisplay());
    }

    public function testBundledDataIsComplete(): void
    {
        $entries = BestiaryData::load();
        $names = array_column($entries, 'name');

        self::assertGreaterThan(700, \count($entries));
        self::assertSame(\count($names), \count(array_unique(array_map('mb_strtolower', $names))), 'names are unique');
        self::assertContains('Dragon Lord', $names);
        foreach (['Kollos', 'Yeti', 'Midnight Panther', 'Askarak Prince'] as $notAWarden) {
            self::assertNotContains($notAWarden, $names, 'only creatures that can be an Echo Warden');
        }
        self::assertLessThanOrEqual(100, max(array_map('mb_strlen', $names)), 'fits monsters.name');
        self::assertLessThanOrEqual(512, max(array_map(static fn (array $e) => mb_strlen((string) $e['image_url']), $entries)), 'fits monsters.image_url');
        self::assertCount(\count($entries), array_filter(array_column($entries, 'image_url')), 'every creature has a GIF');
    }
}
