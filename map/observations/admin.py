from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import Observation


@admin.register(Observation)
class ObservationAdmin(GISModelAdmin):
    list_display = ('species_name', 'user', 'recorded_at', 'h3_cell_res_8')
    list_filter = ('recorded_at', 'user')
    search_fields = ('species_name', 'notes')
    readonly_fields = ('id', 'h3_cell_res_8', 'h3_cell_res_9', 'created_at', 'updated_at')
    date_hierarchy = 'recorded_at'