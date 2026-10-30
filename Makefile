COMPOSE      = docker compose
COMPOSE_PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE_PUBLIC = $(COMPOSE_PROD) -f docker-compose.public.yml
PHP          = $(COMPOSE) exec php

.DEFAULT_GOAL := help
.PHONY: help init up down restart logs ps fixtures migrate test test-backend test-bot test-frontend shell prod-up prod-down public-up public-down

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

init: ## First run: create .env, build, start, load demo data
	@test -f .env || cp .env.example .env
	$(COMPOSE) up -d --build --wait
	$(MAKE) fixtures

up: ## Start the dev stack
	$(COMPOSE) up -d --wait

down: ## Stop the dev stack
	$(COMPOSE) down

restart: down up ## Restart the dev stack

logs: ## Follow logs of all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show service status and health
	$(COMPOSE) ps

migrate: ## Run Doctrine migrations
	$(PHP) bin/console doctrine:migrations:migrate --no-interaction

fixtures: ## Reset the database to the monster list + demo account
	$(PHP) bin/console doctrine:fixtures:load --no-interaction

test: test-backend test-bot test-frontend ## Run all test suites

test-backend: ## PHPUnit (creates the test database on first run)
	$(PHP) bin/console --env=test doctrine:database:create --if-not-exists --quiet
	$(PHP) bin/console --env=test doctrine:migrations:migrate --no-interaction --quiet
	$(PHP) bin/phpunit

test-bot: ## Vitest for the Discord bot
	$(COMPOSE) exec bot npm test

test-frontend: ## Vitest for the frontend
	$(COMPOSE) exec frontend npm test

shell: ## Shell in the PHP container
	$(PHP) sh

prod-up: ## Build and start the production stack
	$(COMPOSE_PROD) up -d --build --wait

prod-down: ## Stop the production stack
	$(COMPOSE_PROD) down

public-up: ## Production build served publicly through the openGym Caddy (see docker-compose.public.yml)
	$(COMPOSE_PUBLIC) up -d --build --wait

public-down: ## Stop the public stack
	$(COMPOSE_PUBLIC) down
