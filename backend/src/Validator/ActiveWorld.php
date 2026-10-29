<?php

namespace App\Validator;

use Symfony\Component\Validator\Constraint;

#[\Attribute(\Attribute::TARGET_PROPERTY)]
final class ActiveWorld extends Constraint
{
    public string $message = 'World {{ value }} is not on the list of active worlds.';
}
