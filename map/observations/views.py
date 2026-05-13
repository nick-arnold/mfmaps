from django.shortcuts import render

# Create your views here.
from rest_framework import permissions, viewsets

from .models import Observation
from .serializers import ObservationSerializer


class ObservationViewSet(viewsets.ModelViewSet):
    """
    List + create + retrieve + update + delete observations.

    Users only see and modify their own observations.
    """
    serializer_class = ObservationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Observation.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)