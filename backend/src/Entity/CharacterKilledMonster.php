<?php

namespace App\Entity;

use App\Repository\CharacterKilledMonsterRepository;
use Doctrine\ORM\Mapping as ORM;

/**
 * A monster ticked off in a character's bestiary. The composite primary key
 * (character_id, monster_id) is what guarantees a monster is recorded only once.
 */
#[ORM\Entity(repositoryClass: CharacterKilledMonsterRepository::class)]
#[ORM\Table(name: 'character_killed_monsters')]
class CharacterKilledMonster
{
    #[ORM\Id]
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Character $character;

    #[ORM\Id]
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Monster $monster;

    #[ORM\Column]
    private \DateTimeImmutable $killedAt;

    public function __construct(Character $character, Monster $monster, \DateTimeImmutable $killedAt = new \DateTimeImmutable())
    {
        $this->character = $character;
        $this->monster = $monster;
        $this->killedAt = $killedAt;
    }

    public function getCharacter(): Character
    {
        return $this->character;
    }

    public function getMonster(): Monster
    {
        return $this->monster;
    }

    public function getKilledAt(): \DateTimeImmutable
    {
        return $this->killedAt;
    }
}
