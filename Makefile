.PHONY: install lint test build docker-build docker-run

install: ## Install dependencies
	npm ci

test: ## Run unit + integration tests
	npm run test

lint: ## Run TypeScript linting
	npm run lint

build: ## Build the frontend bundle
	npm run build

docker-build: ## Build the Docker image locally
	docker build -t mindex:local .

docker-run: ## Run the Docker image locally with .env
	docker run --env-file .env -p 3000:3000 mindex:local
