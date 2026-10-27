#!/bin/sh
# Entrypoint shared by every service built from the app image.
#   api     - gunicorn web server
#   worker  - celery worker with the beat scheduler embedded (single instance)
#   migrate - one-shot: back up the database if migrations are pending, then
#             apply them and make sure the admin user exists
#   *       - any other command is run as-is (e.g. `python manage.py shell`)
set -e

case "$1" in
  api)
    exec gunicorn config.wsgi:application \
      --bind 0.0.0.0:8000 \
      --workers "${GUNICORN_WORKERS:-3}" \
      --timeout 60 \
      --access-logfile -
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
        python -c "import django; django.setup(); from apps.core.tasks import backup_database; print(backup_database())"
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
