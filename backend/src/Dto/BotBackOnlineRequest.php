<?php

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

/** The "bot is back" notice an admin posts on Discord after a deploy. */
final readonly class BotBackOnlineRequest
{
    public function __construct(
        #[Assert\Length(max: 500)]
        public ?string $message = null,
    ) {
    }
}
