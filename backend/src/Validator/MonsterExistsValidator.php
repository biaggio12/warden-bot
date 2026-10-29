<?php

namespace App\Validator;

use App\Repository\MonsterRepository;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

final class MonsterExistsValidator extends ConstraintValidator
{
    public function __construct(private readonly MonsterRepository $monsters)
    {
    }

    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof MonsterExists) {
            throw new UnexpectedTypeException($constraint, MonsterExists::class);
        }

        if (!\is_int($value)) {
            return;
        }

        if (null === $this->monsters->find($value)) {
            $this->context->buildViolation($constraint->message)
                ->setParameter('{{ value }}', (string) $value)
                ->addViolation();
        }
    }
}
