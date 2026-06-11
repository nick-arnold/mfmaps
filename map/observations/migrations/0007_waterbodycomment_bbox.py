from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('observations', '0006_waterbodycomment_click_lat_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='waterbodycomment',
            name='bbox',
            field=models.JSONField(blank=True, null=True),
        ),
    ]