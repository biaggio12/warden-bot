<?php

namespace App\Validator;

use Symfony\Component\Validator\Constraint;

#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class MonsterExists extends Constraint
{
    public string $message = 'There is no monster with id {{ value }}.';
}
