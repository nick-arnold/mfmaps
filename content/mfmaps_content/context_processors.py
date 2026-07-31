from .nav import ordered_sections


def nav(request):
    """Expose the main-nav sections to every template."""
    return {'nav_sections': ordered_sections()}
