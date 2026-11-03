<?php

namespace App\Dto;

use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

/** Which channel of a Discord server gets the alerts of a world. */
final readonly class SetAlertChannelRequest
{
    public function __construct(
        #[SerializedName('guild_id')]
        #[Assert\NotBlank]
        #[Assert\Regex('/^\d{17,20}$/', message: 'Not a Discord server id.')]
        public ?string $guildId = null,
        #[SerializedName('server_name')]
        #[Assert\NotBlank]
        public ?string $serverName = null,
        #[SerializedName('channel_id')]
        #[Assert\NotBlank]
        #[Assert\Regex('/^\d{17,20}$/', message: 'Not a Discord channel id.')]
        public ?string $channelId = null,
    ) {
    }
}
