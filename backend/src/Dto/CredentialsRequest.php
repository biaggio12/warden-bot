<?php

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

final readonly class CredentialsRequest
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Email]
        #[Assert\Length(max: 180)]
        public ?string $email = null,

        #[Assert\NotBlank]
        #[Assert\Length(min: 8, max: 4096)]
        public ?string $password = null,
    ) {
    }
}
