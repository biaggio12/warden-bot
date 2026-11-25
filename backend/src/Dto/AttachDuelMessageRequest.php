<?php

namespace App\Dto;

use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

/** The bot's message that shows a challenge, so the result can update it. */
final readonly class AttachDuelMessageRequest
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Regex('/^\d{5,20}$/')]
        #[SerializedName('channel_id')]
        public ?string $channelId = null,
        #[Assert\NotBlank]
        #[Assert\Regex('/^\d{5,20}$/')]
        #[SerializedName('message_id')]
        public ?string $messageId = null,
    ) {
    }
}
