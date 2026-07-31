from django.contrib import admin
from django.urls import path

from . import views

# ORDER MATTERS.
#
# `about/` and `admin/` must be declared before the `<slug:section>/`
# catch-all, or they get swallowed by it and you'll get a 404 for /about/
# that looks like a template problem but isn't.
#
# Likewise, when species/ and lists/ detail routes are added later, they must
# come BEFORE `<slug:section>/<slug:page>/`, or /fungi/species/morel/ will
# match the generic page route and 404.

urlpatterns = [
    path('', views.home, name='home'),
    path('robots.txt', views.robots_txt, name='robots'),
    path('admin/', admin.site.urls),
    path('about/', views.about, name='about'),

    # Section routes — keep last.
    path('<slug:section>/', views.section_landing, name='section_landing'),
    path('<slug:section>/<slug:page>/', views.section_page, name='section_page'),
]
