from rest_framework import mixins, permissions, viewsets
from rest_framework.response import Response

from .models import Observation, WaterbodyComment
from .serializers import ObservationSerializer, WaterbodyCommentSerializer


class ObservationViewSet(viewsets.ModelViewSet):
    serializer_class = ObservationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Observation.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class WaterbodyCommentViewSet(
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """
    GET    /api/v1/waterbody-comments/?gnis_id=<id>  — list comments (public)
    POST   /api/v1/waterbody-comments/               — post a comment (auth required)
    DELETE /api/v1/waterbody-comments/<uuid>/        — delete own comment (auth required)
    """
    serializer_class = WaterbodyCommentSerializer

    def get_permissions(self):
        if self.action == 'list':
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = WaterbodyComment.objects.select_related('user')
        gnis_id = self.request.query_params.get('gnis_id')
        if gnis_id:
            # Public per-waterbody view: anyone can read all comments here
            return qs.filter(gnis_id=gnis_id)
        # No gnis_id → "my reports" view: auth required, own comments only
        if not self.request.user.is_authenticated:
            return qs.none()
        return qs.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        comment = self.get_object()
        if comment.user != request.user:
            return Response({'detail': 'Not your comment.'}, status=403)
        return super().destroy(request, *args, **kwargs)