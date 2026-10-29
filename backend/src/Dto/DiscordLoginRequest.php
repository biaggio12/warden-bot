<?php

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

final readonly class DiscordLoginRequest
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(max: 512)]
        public ?string $code = null,
    ) {
    }
}
