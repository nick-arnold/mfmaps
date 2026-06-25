from django.contrib import admin
from django.urls import path, include
from django.shortcuts import render
from django.http import HttpResponse
from django.contrib.admin.views.decorators import staff_member_required

def home(request):
    return render(request, 'home.html')


def robots_txt(request):
    return HttpResponse(
        "User-agent: *\nDisallow: /\n",
        content_type="text/plain",
    )

@staff_member_required
def legend_editor(request):
    return render(request, 'map/tools/ak_tree_legend.html')

urlpatterns = [
    path('', home, name='home'),
    path('robots.txt', robots_txt, name='robots'),
    path('admin/', admin.site.urls),

    # API
    path('api/v1/', include('observations.urls')),

    # allauth: traditional server-side flows
    path('accounts/', include('allauth.urls')),

    # allauth: headless API
    path('_allauth/', include('allauth.headless.urls')),

    path('tools/legend-editor/', legend_editor, name='legend_editor'),
]