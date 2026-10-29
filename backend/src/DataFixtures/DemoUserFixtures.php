<?php

namespace App\DataFixtures;

use App\Entity\Character;
use App\Entity\CharacterKilledMonster;
use App\Entity\Monster;
use App\Entity\User;
use Doctrine\Bundle\FixturesBundle\Fixture;
use Doctrine\Common\DataFixtures\DependentFixtureInterface;
use Doctrine\Persistence\ObjectManager;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Development account: demo@warden.local / demo1234
 */
final class DemoUserFixtures extends Fixture implements DependentFixtureInterface
{
    public function __construct(private readonly UserPasswordHasherInterface $hasher)
    {
    }

    public function load(ObjectManager $manager): void
    {
        $user = new User('demo@warden.local');
        $user->setPassword($this->hasher->hashPassword($user, 'demo1234'));
        $manager->persist($user);

        $knight = new Character($user, 'Demo Knight', 'Monza');
        $druid = new Character($user, 'Demo Druid', 'Monza');
        $paladin = new Character($user, 'Demo Paladin', 'Secura');
        foreach ([$knight, $druid, $paladin] as $character) {
            $manager->persist($character);
        }

        foreach (['Dragon', 'Dragon Lord', 'Hydra', 'Giant Spider'] as $name) {
            $manager->persist(new CharacterKilledMonster($knight, $this->getReference('monster:'.$name, Monster::class)));
        }

        $manager->flush();
    }

    public function getDependencies(): array
    {
        return [MonsterFixtures::class];
    }
}
