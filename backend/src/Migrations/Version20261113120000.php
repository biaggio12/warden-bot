<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Adds the Echo Warden creatures from update 15.40 to existing databases, so they show up without
 * running app:bestiary:sync. A creature that is already there (added by the sync) is left as it is.
 */
final class Version20261113120000 extends AbstractMigration
{
    /** name, bestiary class, charm points, GIF - same as data/bestiary.json */
    private const CREATURES = [
        ['Giant Rat', 'Mammal', 25, 'https://static.wikia.nocookie.net/tibia/images/0/00/Giant_Rat.gif/revision/latest?cb=20261110182422&path-prefix=en'],
        ['Greedcarrier Rat', 'Mammal', 25, 'https://static.wikia.nocookie.net/tibia/images/8/8a/Greedcarrier_Rat.gif/revision/latest?cb=20261110182402&path-prefix=en'],
        ['Hoarder Rat', 'Mammal', 25, 'https://static.wikia.nocookie.net/tibia/images/4/4e/Hoarder_Rat.gif/revision/latest?cb=20261110173132&path-prefix=en'],
        ['Greater Greed', 'Elemental', 50, 'https://static.wikia.nocookie.net/tibia/images/2/28/Greater_Greed.gif/revision/latest?cb=20261110182413&path-prefix=en'],
        ['Greed Elemental', 'Elemental', 50, 'https://static.wikia.nocookie.net/tibia/images/3/38/Greed_Elemental.gif/revision/latest?cb=20261110182407&path-prefix=en'],
        ['Greedweaver', 'Elemental', 50, 'https://static.wikia.nocookie.net/tibia/images/5/5c/Greedweaver.gif/revision/latest?cb=20261110182346&path-prefix=en'],
        ['Omega Bastion', 'Human', 50, 'https://static.wikia.nocookie.net/tibia/images/f/f4/Omega_Bastion.gif/revision/latest?cb=20261110173133&path-prefix=en'],
        ['Omega Battler', 'Human', 50, 'https://static.wikia.nocookie.net/tibia/images/a/aa/Omega_Battler.gif/revision/latest?cb=20261110173134&path-prefix=en'],
        ['Omega Bulwark', 'Human', 50, 'https://static.wikia.nocookie.net/tibia/images/a/a0/Omega_Bulwark.gif/revision/latest?cb=20261110173135&path-prefix=en'],
        ['Omega Cinderflayer', 'Human', 100, 'https://static.wikia.nocookie.net/tibia/images/5/5f/Omega_Cinderflayer.gif/revision/latest?cb=20261110173035&path-prefix=en'],
        ['Omega Moonbreaker', 'Human', 100, 'https://static.wikia.nocookie.net/tibia/images/e/e5/Omega_Moonbreaker.gif/revision/latest?cb=20261110173035&path-prefix=en'],
        ['Omega Rampart', 'Human', 100, 'https://static.wikia.nocookie.net/tibia/images/6/64/Omega_Rampart.gif/revision/latest?cb=20261110173036&path-prefix=en'],
    ];

    public function getDescription(): string
    {
        return 'Add the Echo Warden creatures from update 15.40.';
    }

    public function up(Schema $schema): void
    {
        foreach (self::CREATURES as [$name, $category, $charmPoints, $imageUrl]) {
            $this->addSql(
                'INSERT INTO monsters (name, category, charm_points, image_url) VALUES (:name, :category, :charm_points, :image_url) ON CONFLICT (name) DO NOTHING',
                ['name' => $name, 'category' => $category, 'charm_points' => $charmPoints, 'image_url' => $imageUrl],
            );
        }
    }

    public function down(Schema $schema): void
    {
        $names = array_column(self::CREATURES, 0);
        $ids = 'SELECT id FROM monsters WHERE name IN (:names)';
        $params = ['names' => $names];
        $types = ['names' => ArrayParameterType::STRING];

        $this->addSql("DELETE FROM character_killed_monsters WHERE monster_id IN ($ids)", $params, $types);
        $this->addSql("DELETE FROM warden_spawns WHERE monster_id IN ($ids)", $params, $types);
        $this->addSql('DELETE FROM monsters WHERE name IN (:names)', $params, $types);
    }
}
