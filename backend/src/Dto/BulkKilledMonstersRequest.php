<?php

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

final readonly class BulkKilledMonstersRequest
{
    /**
     * @param list<int> $add    monster ids to mark as killed
     * @param list<int> $remove monster ids to unmark
     */
    public function __construct(
        #[Assert\Count(max: 2000)]
        #[Assert\All([new Assert\Type('int'), new Assert\Positive()])]
        public array $add = [],

        #[Assert\Count(max: 2000)]
        #[Assert\All([new Assert\Type('int'), new Assert\Positive()])]
        public array $remove = [],
    ) {
    }
}
