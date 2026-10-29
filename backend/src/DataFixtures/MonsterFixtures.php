<?php

namespace App\DataFixtures;

use App\Entity\Monster;
use App\Service\BestiaryData;
use Doctrine\Bundle\FixturesBundle\Fixture;
use Doctrine\Persistence\ObjectManager;

/**
 * The full Tibia bestiary from data/bestiary.json. To update an existing database without
 * wiping it, use `bin/console app:bestiary:sync` instead.
 */
final class MonsterFixtures extends Fixture
{
    public function load(ObjectManager $manager): void
    {
        foreach (BestiaryData::load() as $entry) {
            $monster = new Monster($entry['name'], $entry['category'], $entry['charm_points'], $entry['image_url']);
            $manager->persist($monster);
            $this->addReference('monster:'.$entry['name'], $monster);
        }

        $manager->flush();
    }
}
