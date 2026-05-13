from django.db import migrations


def backfill_h3_res_10(apps, schema_editor):
    import h3
    Observation = apps.get_model('observations', 'Observation')
    for obs in Observation.objects.all():
        if obs.location:
            lat = obs.location.y
            lng = obs.location.x
            obs.h3_cell_res_10 = h3.latlng_to_cell(lat, lng, 10)
            obs.save(update_fields=['h3_cell_res_10'])


def reverse_noop(apps, schema_editor):
    # Nothing to undo — column is dropped by reversing 0002
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('observations', '0002_observation_h3_cell_res_10_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_h3_res_10, reverse_noop),
    ]