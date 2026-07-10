.PHONY: up down lan build backup restore

# Compose lives in infrastructure/docker/; --env-file keeps root .env interpolation working.
COMPOSE = docker compose -f infrastructure/docker/docker-compose.yml --env-file .env

up:
	$(COMPOSE) up -d

lan:
	$(COMPOSE) -f infrastructure/docker/docker-compose.lan.yml up -d

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

backup:
	$(COMPOSE) exec -T db pg_dump --clean --if-exists -U skin skin > database/backups/backup-$$(date +%Y%m%d-%H%M%S).sql

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=database/backups/backup-....sql" && exit 1)
	cat $(FILE) | $(COMPOSE) exec -T db psql -U skin skin
