<?php

namespace App\Dto;

use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

final readonly class ChangePasswordRequest
{
    public function __construct(
        #[SerializedName('current_password')]
        #[Assert\NotBlank]
        public ?string $currentPassword = null,

        #[SerializedName('new_password')]
        #[Assert\NotBlank]
        #[Assert\Length(min: 8, max: 4096)]
        public ?string $newPassword = null,
    ) {
    }
}
