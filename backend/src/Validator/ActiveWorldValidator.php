<?php

namespace App\Validator;

use App\Service\WorldRegistry;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

final class ActiveWorldValidator extends ConstraintValidator
{
    public function __construct(private readonly WorldRegistry $worlds)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof ActiveWorld) {
            throw new UnexpectedTypeException($constraint, ActiveWorld::class);
        }

        if (null === $value || '' === $value) {
            return;
        }

        if (!\is_string($value) || !$this->worlds->isActive($value)) {
            $this->context->buildViolation($constraint->message)
                ->setParameter('{{ value }}', $this->formatValue($value))
                ->addViolation();
        }
    }
}
