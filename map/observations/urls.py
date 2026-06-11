from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ObservationViewSet, WaterbodyCommentViewSet

router = DefaultRouter()
router.register(r'observations', ObservationViewSet, basename='observation')
router.register(r'waterbody-comments', WaterbodyCommentViewSet, basename='waterbody-comment')

urlpatterns = [
    path('', include(router.urls)),
]