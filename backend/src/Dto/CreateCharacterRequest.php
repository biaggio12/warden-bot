<?php

namespace App\Dto;

use App\Validator\ActiveWorld;
use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

final readonly class CreateCharacterRequest
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(min: 2, max: 30)]
        #[Assert\Regex(pattern: "/^[A-Za-z][A-Za-z' -]*[A-Za-z]$/", message: 'A character name may only contain letters, spaces, apostrophes and hyphens.')]
        public ?string $name = null,

        #[SerializedName('server_name')]
        #[Assert\NotBlank]
        #[ActiveWorld]
        public ?string $serverName = null,
    ) {
    }
}
