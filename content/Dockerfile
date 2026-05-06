# Python 3.12 to match the droplet
FROM python:3.12-slim-bookworm

# Don't write .pyc files, don't buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System dependencies
# - libpq-dev: Postgres client headers (psycopg may need them at runtime in some configs)
# - build-essential: gcc and friends, only needed at install time; we keep it minimal
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# App lives here
WORKDIR /app

# Install Python deps first (cache-friendly: only reruns if requirements.txt changes)
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the rest of the code
COPY . .

# Collect static files (Django admin CSS, etc.) into /app/staticfiles
# This bakes them into the image so nginx can serve them via a shared volume.
# We need a placeholder SECRET_KEY just to run collectstatic; real key comes from env at runtime.
ENV DJANGO_SETTINGS_MODULE=mfmaps_content.settings \
    SECRET_KEY=collectstatic-placeholder \
    DB_NAME=placeholder \
    DB_USER=placeholder \
    DB_PASSWORD=placeholder \
    DB_HOST=placeholder
RUN python manage.py collectstatic --noinput

# Run as non-root for safety
RUN groupadd --system django && useradd --system --gid django django && \
    chown -R django:django /app
USER django

# gunicorn binds inside the container; nginx will proxy to it from the host network
EXPOSE 8000
CMD ["gunicorn", "mfmaps_content.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]