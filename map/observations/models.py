from django.db import models

# Create your models here.
import uuid

import h3
from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.db import models


class Observation(models.Model):
    """
    A user-recorded foraging observation: where, when, what species.

    The exact lat/lng is owned by the user. H3 cells at multiple
    resolutions are computed on save to support privacy-preserving
    community aggregation (planned).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='observations',
    )

    # What
    species_name = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    # Where (exact)
    location = gis_models.PointField(geography=True, srid=4326)
    accuracy_meters = models.FloatField(null=True, blank=True)

    # Where (privacy-preserving aggregation buckets, computed on save)
    # H3 cells at multiple resolutions, computed on save.
    # res_10 (~66m) — user's private view, finest resolution we store
    # res_9 (~175m) — intermediate
    # res_8 (~750m) — community-safe aggregation resolution
    h3_cell_res_8 = models.CharField(max_length=20, db_index=True, blank=True)
    h3_cell_res_9 = models.CharField(max_length=20, db_index=True, blank=True)
    h3_cell_res_10 = models.CharField(max_length=20, db_index=True, blank=True)

    # When
    recorded_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-recorded_at', '-created_at']
        indexes = [
            models.Index(fields=['user', '-recorded_at']),
            models.Index(fields=['h3_cell_res_8']),
            models.Index(fields=['h3_cell_res_9']),
            models.Index(fields=['h3_cell_res_10']),
        ]

    def save(self, *args, **kwargs):
        if self.location:
            lat = self.location.y
            lng = self.location.x
            self.h3_cell_res_8 = h3.latlng_to_cell(lat, lng, 8)
            self.h3_cell_res_9 = h3.latlng_to_cell(lat, lng, 9)
            self.h3_cell_res_10 = h3.latlng_to_cell(lat, lng, 10)
        super().save(*args, **kwargs)

    def __str__(self):
        species = self.species_name or '(no species)'
        return f"{species} @ {self.recorded_at:%Y-%m-%d}"