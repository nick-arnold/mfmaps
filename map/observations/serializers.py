import json

from django.contrib.gis.geos import GEOSGeometry
from rest_framework_gis.serializers import GeoFeatureModelSerializer

from .models import Observation


class ObservationSerializer(GeoFeatureModelSerializer):
    """
    Serializes Observation as GeoJSON Feature, suitable for MapLibre.
    """

    class Meta:
        model = Observation
        geo_field = 'location'
        fields = [
            'id',
            'species_name',
            'notes',
            'accuracy_meters',
            'h3_cell_res_8',
            'h3_cell_res_9',
            'recorded_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'h3_cell_res_8',
            'h3_cell_res_9',
            'created_at',
            'updated_at',
        ]

    def create(self, validated_data):
        # rest_framework_gis hands us `location` as a Python dict; convert to GEOS
        loc = validated_data.get('location')
        if isinstance(loc, dict):
            validated_data['location'] = GEOSGeometry(json.dumps(loc))
        return super().create(validated_data)

    def update(self, instance, validated_data):
        loc = validated_data.get('location')
        if isinstance(loc, dict):
            validated_data['location'] = GEOSGeometry(json.dumps(loc))
        return super().update(instance, validated_data)