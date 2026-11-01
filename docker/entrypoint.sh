#!/bin/sh
# Entrypoint shared by every service built from the app image.
#   api     - uvicorn web server (ASGI: open tabs keep a stream of changes)
#   worker  - celery worker with the beat scheduler embedded (single instance)
#   migrate - one-shot: back up the database if migrations are pending, then
#             apply them and make sure the admin user exists
#   *       - any other command is run as-is (e.g. `python manage.py shell`)
set -e

case "$1" in
  api)
    # Streams stay open: on stop, they are cut after a few seconds so the
    # container doesn't wait for Docker to kill it.
    exec uvicorn config.asgi:application \
      --host 0.0.0.0 \
      --port 8000 \
      --workers "${WEB_WORKERS:-3}" \
      --lifespan off \
      --timeout-graceful-shutdown 5
    ;;
  worker)
    exec celery -A config worker --beat \
      --concurrency "${CELERY_WORKER_CONCURRENCY:-2}" \
      --schedule /tmp/celerybeat-schedule \
      --loglevel info
    ;;
  migrate)
    if ! python manage.py migrate --check >/dev/null 2>&1; then
      if python manage.py showmigrations --plan | grep -q '^\[X\]'; then
        echo "Pending migrations: backing up the database first."
        # Through manage.py, which picks the settings module from ENVIRONMENT.
        python manage.py shell -v 0 -c "from apps.core.tasks import backup_database; print(backup_database())"
      fi
      python manage.py migrate --no-input
    else
      echo "No pending migrations."
    fi
    python manage.py ensure_admin
    ;;
  *)
    exec "$@"
    ;;
esac
