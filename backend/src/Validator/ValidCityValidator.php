<?php

namespace App\Validator;

use App\Service\CityRegistry;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

final class ValidCityValidator extends ConstraintValidator
{
    public function __construct(private readonly CityRegistry $cities)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof ValidCity) {
            throw new UnexpectedTypeException($constraint, ValidCity::class);
        }

        if (null === $value || '' === $value) {
            return;
        }

        if (!\is_string($value) || !$this->cities->isValid($value)) {
            $this->context->buildViolation($constraint->message)
                ->setParameter('{{ value }}', $this->formatValue($value))
                ->addViolation();
        }
    }
}
