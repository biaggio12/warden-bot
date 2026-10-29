<?php

namespace App\Dto;

use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

final readonly class LinkDiscordRequest
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(max: 16)]
        public ?string $code = null,

        #[SerializedName('discord_user_id')]
        #[Assert\NotBlank]
        #[Assert\Regex(pattern: '/^\d{5,32}$/', message: 'Invalid Discord user id.')]
        public ?string $discordUserId = null,
    ) {
    }
}
