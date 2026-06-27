from django.contrib import admin
from django.urls import path, include
from django.shortcuts import render
from django.http import HttpResponse
from django.contrib.admin.views.decorators import staff_member_required
import json
import boto3
from botocore.client import Config
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

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

@staff_member_required
@require_POST
@csrf_exempt
def save_legend_staging(request, region):
    if region not in ('conus', 'ak', 'hi'):
        return JsonResponse({'error': 'invalid region'}, status=400)

    try:
        payload = json.loads(request.body.decode('utf-8'))
    except Exception as e:
        return JsonResponse({'error': f'invalid json: {e}'}, status=400)

    if region == 'conus':
        label = 'treemap_composite_conus'
    else:
        label = f'landfire_evt_{region}'
    key = f'tree-species/{label}_legend_staging.json'

    try:
        s3 = boto3.client(
            's3',
            endpoint_url=settings.DO_SPACES_ENDPOINT,
            aws_access_key_id=settings.DO_SPACES_KEY,
            aws_secret_access_key=settings.DO_SPACES_SECRET,
            region_name=settings.DO_SPACES_REGION,
            config=Config(signature_version='s3v4'),
        )
        s3.put_object(
            Bucket=settings.DO_SPACES_BUCKET,
            Key=key,
            Body=json.dumps(payload, indent=2).encode('utf-8'),
            ContentType='application/json',
            ACL='public-read',
        )
    except Exception as e:
        return JsonResponse({'error': f'upload failed: {e}'}, status=500)

    return JsonResponse({'ok': True, 'key': key})

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
    path('tools/legend-editor/save/<str:region>/', save_legend_staging, name='save_legend_staging'),
]
