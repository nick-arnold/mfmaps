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
        from django.db.models import Q
        qs = WaterbodyComment.objects.select_related('user')
        gnis_id = self.request.query_params.get('gnis_id')
        scope = self.request.query_params.get('scope')

        if gnis_id:
            # Popup view: public comments + viewer's own private comments
            qs = qs.filter(gnis_id=gnis_id)
            if self.request.user.is_authenticated:
                return qs.filter(Q(is_public=True) | Q(user=self.request.user))
            return qs.filter(is_public=True)

        if scope == 'public':
            # Public reports feed: everyone's public comments
            return qs.filter(is_public=True).order_by('-created_at')

        # Default: own comments only (both public and private)
        if not self.request.user.is_authenticated:
            return qs.none()
        return qs.filter(user=self.request.user).order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        comment = self.get_object()
        if comment.user != request.user:
            return Response({'detail': 'Not your comment.'}, status=403)
        return super().destroy(request, *args, **kwargs)