.PHONY: up down lan build backup restore

up:
	docker compose up -d

lan:
	docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d

down:
	docker compose down

build:
	docker compose build

backup:
	docker compose exec -T db pg_dump --clean --if-exists -U skin skin > backup-$$(date +%Y%m%d-%H%M%S).sql

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=backup-....sql" && exit 1)
	cat $(FILE) | docker compose exec -T db psql -U skin skin
