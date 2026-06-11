import uuid

import h3
from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.db import models


class Observation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='observations',
    )
    species_name = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    location = gis_models.PointField(geography=True, srid=4326)
    accuracy_meters = models.FloatField(null=True, blank=True)
    h3_cell_res_8 = models.CharField(max_length=20, db_index=True, blank=True)
    h3_cell_res_9 = models.CharField(max_length=20, db_index=True, blank=True)
    h3_cell_res_10 = models.CharField(max_length=20, db_index=True, blank=True)
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
        return f"{self.species_name or '(no species)'} @ {self.recorded_at:%Y-%m-%d}"


class WaterbodyComment(models.Model):
    """
    A user comment on an NHD water body or stream, keyed on gnis_id.

    gnis_id is the stable NHD identifier present in tile properties across
    all three sources (nhd, nhd_conus, nhd_ak). gnis_name is denormalized
    from the tile at post time — no lookup needed at read time.
    Comments are public (any visitor can read; auth required to post).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='waterbody_comments',
    )
    gnis_id = models.CharField(max_length=20, db_index=True)
    gnis_name = models.CharField(max_length=200, blank=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_public = models.BooleanField(default=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['gnis_id', 'created_at']),
        ]

    def __str__(self):
        return f"{self.user} on {self.gnis_name or self.gnis_id}"