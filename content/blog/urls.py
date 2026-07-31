from django.urls import path

from . import upload_views, views

app_name = 'blog'

# ORDER MATTERS.
#
# `<slug:slug>/` is a catch-all within /blog/. Any fixed route added later
# (feeds, tag pages, search) must be declared ABOVE it, or the catch-all
# swallows it and you get a confusing 404. The reserved-slug list in
# models.py exists to keep those words free.

urlpatterns = [
    path('', views.index, name='index'),
    path('upload-image/', upload_views.upload_image, name='upload_image'),
    path('<slug:slug>/', views.entry, name='entry'),
]