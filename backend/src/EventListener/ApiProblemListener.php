<?php

namespace App\EventListener;

use App\Http\Problem;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Serializer\NameConverter\CamelCaseToSnakeCaseNameConverter;
use Symfony\Component\Validator\ConstraintViolationInterface;
use Symfony\Component\Validator\Exception\ValidationFailedException;

/**
 * Renders every error under /api as application/problem+json (RFC 7807).
 * Runs after the security firewall (priority 1) has turned access errors into HTTP exceptions.
 */
#[AsEventListener(event: KernelEvents::EXCEPTION, priority: -1)]
final readonly class ApiProblemListener
{
    public function __construct(
        private LoggerInterface $logger,
        #[Autowire('%kernel.debug%')]
        private bool $debug,
    ) {
    }

    public function __invoke(ExceptionEvent $event): void
    {
        if (!str_starts_with($event->getRequest()->getPathInfo(), '/api/')) {
            return;
        }

        $exception = $event->getThrowable();

        if ($exception->getPrevious() instanceof ValidationFailedException) {
            $event->setResponse($this->validationProblem($exception->getPrevious()));

            return;
        }

        if ($exception instanceof HttpExceptionInterface) {
            $response = Problem::response($exception->getStatusCode(), $exception->getMessage());
            $response->headers->add($exception->getHeaders());
            $event->setResponse($response);

            return;
        }

        $this->logger->error('Unhandled API exception: {message}', ['message' => $exception->getMessage(), 'exception' => $exception]);
        $event->setResponse(Problem::response(500, $this->debug ? $exception->getMessage() : 'An unexpected server error occurred.'));
    }

    private function validationProblem(ValidationFailedException $exception): JsonResponse
    {
        $names = new CamelCaseToSnakeCaseNameConverter();
        $violations = [];

        /** @var ConstraintViolationInterface $violation */
        foreach ($exception->getViolations() as $violation) {
            $violations[] = [
                'property_path' => $names->normalize($violation->getPropertyPath()),
                'title' => $violation->getMessage(),
                'code' => $violation->getCode(),
            ];
        }

        return Problem::response(422, 'The submitted data is invalid.', [
            'type' => 'https://datatracker.ietf.org/doc/html/rfc4918#section-11.2',
            'violations' => $violations,
        ]);
    }
}
