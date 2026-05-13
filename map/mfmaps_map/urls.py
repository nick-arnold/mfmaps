from django.contrib import admin
from django.urls import path, include
from django.shortcuts import render
from django.http import HttpResponse


def home(request):
    return render(request, 'home.html')


def robots_txt(request):
    return HttpResponse(
        "User-agent: *\nDisallow: /\n",
        content_type="text/plain",
    )


urlpatterns = [
    path('', home, name='home'),
    path('robots.txt', robots_txt, name='robots'),
    path('admin/', admin.site.urls),

    # allauth: traditional server-side flows (login pages, password reset)
    path('accounts/', include('allauth.urls')),

    # allauth: headless API (DRF-compatible endpoints for SPA auth)
    path('_allauth/', include('allauth.headless.urls')),
]