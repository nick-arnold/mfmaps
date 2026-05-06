# MF Maps

Foraging intelligence platform — cartographic quality first, multi-species probability layers, H3-based community spot reporting.

## Architecture

Two Django projects sharing one PostGIS database:
- content/ → mfmaps.com — server-rendered content site, species pages, regional foraging guides
- map/ → map.mfmaps.com — Django REST API + React frontend, full map app

## Stack

- Django 5.x, Python 3.12
- PostgreSQL 17 + PostGIS 3.5 + H3 4.x (DigitalOcean Managed)
- nginx + gunicorn (containerized)
- MapLibre GL JS, PMTiles on DO Spaces + CDN
- Docker Compose for orchestration

## Development

(TBD — being set up.)

## Deployment

(TBD — being set up.)