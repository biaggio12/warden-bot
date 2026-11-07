<?php

namespace App\Dto;

use Symfony\Component\Serializer\Attribute\SerializedName;
use Symfony\Component\Validator\Constraints as Assert;

/** The full [OMW] / [No Need] lists of one alert, in click order. */
final readonly class UpdatePresenceRequest
{
    public function __construct(
        /** @var list<string> */
        #[SerializedName('on_my_way')]
        #[Assert\Count(max: 1000)]
        #[Assert\All([new Assert\Type('string'), new Assert\Regex('/^\d{5,32}$/', message: 'Invalid Discord user id.')])]
        public array $onMyWay = [],

        /** @var list<string> */
        #[SerializedName('on_site')]
        #[Assert\Count(max: 1000)]
        #[Assert\All([new Assert\Type('string'), new Assert\Regex('/^\d{5,32}$/', message: 'Invalid Discord user id.')])]
        public array $onSite = [],
    ) {
    }
}
