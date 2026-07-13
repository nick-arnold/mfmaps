FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

    RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    ca-certificates \
    gdal-bin \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
    binutils \
&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

# Cache-bust static assets on every deploy — inject the app version from the
# build environment (typically a git short hash) and persist to runtime env.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

ENV DJANGO_SETTINGS_MODULE=mfmaps_map.settings \
    SECRET_KEY=collectstatic-placeholder \
    DB_NAME=placeholder \
    DB_USER=placeholder \
    DB_PASSWORD=placeholder \
    DB_HOST=placeholder
RUN python manage.py collectstatic --noinput

RUN groupadd --system django && useradd --system --gid django django && \
    chown -R django:django /app
USER django

EXPOSE 8000
CMD ["gunicorn", "mfmaps_map.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]