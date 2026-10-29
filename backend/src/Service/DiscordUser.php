<?php

namespace App\Service;

final readonly class DiscordUser
{
    public function __construct(
        public string $id,
        public string $username,
        /** Only set when Discord reports the address as verified. */
        public ?string $verifiedEmail,
    ) {
    }
}
