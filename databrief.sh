#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env"

usage() {
  cat <<EOF
Usage: ./databrief.sh <command> [args]

Commands:
  start              Build images (if needed) and start all services; print URLs.
  stop               Stop running containers (data volume preserved).
  restart [service]  Restart all services or one (e.g. backend, frontend, clickhouse).
  down               Stop and remove containers; data volume preserved.
  logs [service]     Tail logs for all services or one.
  reset              Destroy containers AND the ClickHouse data volume (prompts first).
  hash               Prompt for a password and print its Argon2id hash for .env.

EOF
  exit 1
}

require_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env file not found."
    echo "  Copy .env.example to .env and fill in the values:"
    echo "    cp .env.example .env"
    exit 1
  fi
}

case "${1:-}" in
  start)
    require_env
    echo "==> Starting DataBrief..."
    docker compose up -d --build
    echo ""
    echo "Services are up:"
    echo "  Frontend     http://localhost:5173"
    echo "  Backend      http://localhost:8000"
    echo "  ClickHouse   http://localhost:8123"
    echo "  CH-UI        http://localhost:5521  (ClickHouse query UI)"
    ;;

  stop)
    require_env
    echo "==> Stopping DataBrief..."
    docker compose stop
    ;;

  restart)
    require_env
    SERVICE="${2:-}"
    echo "==> Restarting ${SERVICE:-all services}..."
    docker compose restart $SERVICE
    ;;

  down)
    require_env
    echo "==> Removing DataBrief containers (data volume preserved)..."
    docker compose down
    ;;

  logs)
    require_env
    SERVICE="${2:-}"
    docker compose logs -f $SERVICE
    ;;

  reset)
    require_env
    echo "WARNING: This will destroy all containers AND the ClickHouse data volume."
    echo "All datasets, chat history, and metadata will be permanently deleted."
    printf "Type 'yes' to confirm: "
    read -r CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
      echo "Aborted."
      exit 0
    fi
    echo "==> Destroying containers and data volume..."
    docker compose down -v
    echo "Done. Run './databrief.sh start' to start fresh."
    ;;

  hash)
    require_env
    echo "Enter a password to hash (input will be visible):"
    printf "> "
    read -r PASSWORD
    echo ""
    echo "Argon2id hash:"
    docker compose run --rm backend python -c \
      "from argon2 import PasswordHasher; print(PasswordHasher().hash('${PASSWORD//\'/\'\\\'\'}'))"
    echo ""
    echo "Paste this value into .env as APP_PASSWORD_HASH=<hash>"
    ;;

  *)
    usage
    ;;
esac
