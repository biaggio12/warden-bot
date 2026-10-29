<?php

namespace App\Entity;

use App\Repository\MonsterRepository;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: MonsterRepository::class)]
#[ORM\Table(name: 'monsters')]
#[ORM\Index(name: 'idx_monsters_category', columns: ['category'])]
class Monster
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 100, unique: true)]
    private string $name;

    #[ORM\Column(length: 50)]
    private string $category;

    #[ORM\Column]
    private int $charmPoints;

    /** Animated creature GIF on TibiaWiki. */
    #[ORM\Column(length: 512, nullable: true)]
    private ?string $imageUrl;

    public function __construct(string $name, string $category, int $charmPoints, ?string $imageUrl = null)
    {
        $this->name = $name;
        $this->category = $category;
        $this->charmPoints = $charmPoints;
        $this->imageUrl = $imageUrl;
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getCategory(): string
    {
        return $this->category;
    }

    public function getCharmPoints(): int
    {
        return $this->charmPoints;
    }

    public function getImageUrl(): ?string
    {
        return $this->imageUrl;
    }

    public function updateBestiaryEntry(string $category, int $charmPoints, ?string $imageUrl): void
    {
        $this->category = $category;
        $this->charmPoints = $charmPoints;
        $this->imageUrl = $imageUrl;
    }
}
