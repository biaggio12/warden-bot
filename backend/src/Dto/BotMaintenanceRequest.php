<?php

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

/** The maintenance notice an admin posts on Discord before a deploy. */
final readonly class BotMaintenanceRequest
{
    public function __construct(
        /** About how many minutes the bot will be down (shown as "back around …"). */
        #[Assert\Range(min: 1, max: 240)]
        public ?int $minutes = null,
        #[Assert\Length(max: 500)]
        public ?string $message = null,
    ) {
    }
}
