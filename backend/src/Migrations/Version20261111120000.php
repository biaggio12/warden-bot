<?php

declare(strict_types=1);

namespace App\Migrations;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Removes the creatures that cannot spawn as an Echo Warden (they left data/bestiary.json),
 * together with the bestiary marks and spawn reports that still point at them -
 * app:bestiary:sync keeps creatures that are in use, so it cannot drop these on its own.
 */
final class Version20261111120000 extends AbstractMigration
{
    private const NOT_WARDENS = [
        'Acolyte of Darkness',
        'Albino Dragon',
        'Animated Snowman',
        'Askarak Lord',
        'Askarak Prince',
        'Baleful Bunny',
        'Bane Bringer',
        'Bane of Light',
        'Bellicose Orger',
        'Berrypest',
        'Bride of Night',
        'Cake Golem',
        'Cow',
        'Crustacea Gigantica',
        'Crypt Defiler',
        'Crystal Wolf',
        'Death Priest',
        'Deepling Master Librarian',
        'Deepling Tyrant',
        'Diamond Servant',
        'Diamond Servant Replica',
        'Dire Penguin',
        'Doomsday Cultist',
        'Draptor',
        'Dryad',
        'Duskbringer',
        'Elder Mummy',
        'Elf Overseer',
        'Feverish Citizen',
        'Firestarter',
        'Ghost Wolf',
        'Ghoulish Hyaena',
        'Goblin Leader',
        'Golden Servant',
        'Golden Servant Replica',
        'Grave Guard',
        'Grave Robber',
        'Grynch Clan Goblin',
        'Haunted Dragon',
        'Herald of Gloom',
        'Hive Overseer',
        'Honey Elemental',
        'Honour Guard',
        'Horse (Taupe)',
        'Ice Dragon',
        'Iks Ahpututu',
        'Iks Churrascan',
        'Imperial',
        'Ink Splash',
        'Insectoid Scout',
        'Iron Servant',
        'Kollos',
        'Ladybug',
        'Lizard Commander',
        'Loricate Orger',
        'Manta Ray',
        'Midnight Panther',
        'Midnight Spawn',
        'Midnight Warrior',
        'Minotaur Invader',
        'Nightfiend',
        'Nightslayer',
        'Orger',
        'Percht',
        'Raging Fire',
        'Renegade Quara Constrictor',
        'Renegade Quara Hydromancer',
        'Renegade Quara Mantassin',
        'Renegade Quara Pincher',
        'Renegade Quara Predator',
        'Roast Pork',
        'Sacred Spider',
        'Sandstone Scorpion',
        'Schiach',
        'Sea Captain',
        'Seacrest Serpent',
        'Shaburak Lord',
        'Shaburak Prince',
        'Shadow Hound',
        'Spidris',
        'Spidris Elite',
        'Squidgy Slime',
        'Starving Wolf',
        'Thornfire Wolf',
        'Tomb Servant',
        'Troll Guard',
        'Undead Cavebear',
        'Undead Jester',
        'Vicious Manbat',
        'Water Buffalo',
        'White Deer',
        'Wild Horse',
        'Yeti',
    ];

    public function getDescription(): string
    {
        return 'Remove creatures that cannot be an Echo Warden, with their bestiary marks and spawn reports.';
    }

    public function up(Schema $schema): void
    {
        $ids = 'SELECT id FROM monsters WHERE name IN (:names)';
        $params = ['names' => self::NOT_WARDENS];
        $types = ['names' => ArrayParameterType::STRING];

        $this->addSql("DELETE FROM character_killed_monsters WHERE monster_id IN ($ids)", $params, $types);
        $this->addSql("DELETE FROM warden_spawns WHERE monster_id IN ($ids)", $params, $types);
        $this->addSql('DELETE FROM monsters WHERE name IN (:names)', $params, $types);
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException('Deleted bestiary marks and spawn reports cannot be restored; app:bestiary:sync re-adds only creatures listed in data/bestiary.json.');
    }
}
