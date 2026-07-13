from django.conf import settings


def app_version(request):
    """Expose APP_VERSION to all templates for cache-busting static assets."""
    return {'APP_VERSION': settings.APP_VERSION}