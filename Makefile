.PHONY: test lint build docker-run

test: ## Run unit + integration tests
	npm run test

lint: ## Run TypeScript linting
	npm run lint

build: ## Build the frontend bundle
	npm run build

docker-run: ## Build and run the Docker stack locally
	docker compose up --build -d
