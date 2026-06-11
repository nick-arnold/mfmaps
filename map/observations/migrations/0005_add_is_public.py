from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('observations', '0004_waterbodycomment'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE observations_waterbodycomment ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;",
            reverse_sql="ALTER TABLE observations_waterbodycomment DROP COLUMN IF EXISTS is_public;",
            state_operations=[],
        ),
    ]