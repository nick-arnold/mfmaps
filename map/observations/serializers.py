from rest_framework import serializers
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