import json

from django.contrib.gis.geos import GEOSGeometry
from rest_framework_gis.fields import GeometryField
from rest_framework_gis.serializers import GeoFeatureModelSerializer

from rest_framework import serializers

from .models import WaterbodyComment
from .models import Observation


class ObservationSerializer(GeoFeatureModelSerializer):
    """
    Serializes Observation as GeoJSON Feature, suitable for MapLibre.
    """

    # Force the geometry field to use GeoJSON dict representation,
    # bypassing the geography=True + WKT string fallback.
    location = GeometryField()

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
            'h3_cell_res_10',
            'recorded_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'h3_cell_res_8',
            'h3_cell_res_9',
            'h3_cell_res_10',
            'created_at',
            'updated_at',
        ]

    def create(self, validated_data):
        loc = validated_data.get('location')
        if isinstance(loc, dict):
            validated_data['location'] = GEOSGeometry(json.dumps(loc))
        return super().create(validated_data)

    def update(self, instance, validated_data):
        loc = validated_data.get('location')
        if isinstance(loc, dict):
            validated_data['location'] = GEOSGeometry(json.dumps(loc))
        return super().update(instance, validated_data)
    



class WaterbodyCommentSerializer(serializers.ModelSerializer):
    username = serializers.SerializerMethodField()

    class Meta:
        model = WaterbodyComment
        fields = ['id', 'gnis_id', 'gnis_name', 'body', 'is_public', 'click_lng', 'click_lat', 'username', 'created_at', 'updated_at']
        read_only_fields = ['id', 'username', 'created_at', 'updated_at']

    def get_username(self, obj):
        return obj.user.get_username()