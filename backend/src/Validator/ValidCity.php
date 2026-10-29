<?php

namespace App\Validator;

use Symfony\Component\Validator\Constraint;

#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class ValidCity extends Constraint
{
    public string $message = 'City {{ value }} is not on the list of cities.';
}
