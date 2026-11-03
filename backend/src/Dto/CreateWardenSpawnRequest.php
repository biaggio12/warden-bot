<?php

namespace App\Dto;

use App\Entity\WardenSpawn;
use App\Service\PlainTextSanitizer;
use App\Validator\ActiveWorld;
use App\Validator\MonsterExists;
use App\Validator\ValidCity;
use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

final readonly class CreateWardenSpawnRequest
{
    /** Sanitized before validation, so the length limits apply to what gets stored. */
    #[SerializedName('location_description')]
    #[Assert\NotBlank]
    #[Assert\Length(min: 5, max: 255)]
    public ?string $locationDescription;

    /** Optional free-form notes; line breaks are kept. */
    #[SerializedName('additional_info')]
    #[Assert\Length(max: 500)]
    public ?string $additionalInfo;

    public function __construct(
        #[SerializedName('monster_id')]
        #[Assert\NotNull]
        #[Assert\Positive]
        #[MonsterExists]
        public ?int $monsterId = null,

        #[SerializedName('server_name')]
        #[Assert\NotBlank]
        #[ActiveWorld]
        public ?string $serverName = null,

        ?string $locationDescription = null,

        #[SerializedName('ttl_minutes')]
        // A Warden disappears on its own 10 minutes after it shows up.
        #[Assert\Range(min: 1, max: WardenSpawn::MAX_TTL_MINUTES)]
        public int $ttlMinutes = WardenSpawn::DEFAULT_TTL_MINUTES,

        #[ValidCity]
        public ?string $city = null,

        ?string $additionalInfo = null,

        /** Set by the bot for /warden: the Discord server the alert belongs to. */
        #[SerializedName('discord_guild_id')]
        #[Assert\Regex('/^\d{17,20}$/', message: 'Not a Discord server id.')]
        public ?string $discordGuildId = null,
    ) {
        $this->locationDescription = null === $locationDescription ? null : PlainTextSanitizer::sanitize($locationDescription);
        $info = null === $additionalInfo ? '' : PlainTextSanitizer::sanitizeMultiline($additionalInfo);
        $this->additionalInfo = '' === $info ? null : $info;
    }
}
