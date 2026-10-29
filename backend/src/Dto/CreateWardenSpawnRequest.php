<?php

namespace App\Dto;

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
        #[Assert\Range(min: 3, max: 30)]
        public int $ttlMinutes = 7,

        #[ValidCity]
        public ?string $city = null,

        ?string $additionalInfo = null,
    ) {
        $this->locationDescription = null === $locationDescription ? null : PlainTextSanitizer::sanitize($locationDescription);
        $info = null === $additionalInfo ? '' : PlainTextSanitizer::sanitizeMultiline($additionalInfo);
        $this->additionalInfo = '' === $info ? null : $info;
    }
}
