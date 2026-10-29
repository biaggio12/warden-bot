<?php

namespace App\Dto;

use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

final readonly class MarkMonsterKilledRequest
{
    public function __construct(
        #[SerializedName('monster_id')]
        #[Assert\NotNull]
        #[Assert\Positive]
        public ?int $monsterId = null,
    ) {
    }
}
