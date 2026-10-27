# Shared by the backup/restore scripts. Override COMPOSE to target another
# stack, e.g. COMPOSE="docker compose -p brain-test --env-file x.env -f ...".
COMPOSE=${COMPOSE:-"docker compose --env-file stack.env -f docker-compose.production.yml"}

compose() {
  # shellcheck disable=SC2086
  $COMPOSE "$@"
}

cd "$(dirname "$0")/.." || exit 1
