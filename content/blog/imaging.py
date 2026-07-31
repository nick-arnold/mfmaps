"""
Uploaded photo -> web-ready image.

Three things happen here, and the third is the one that matters most:

1. Cap the long edge at MAX_EDGE. A modern phone shoots ~4000px; nothing on
   the site displays wider than about 1100, so anything past 2000 is bytes
   the reader pays for and never sees.
2. Re-encode as WebP. Typically 10-30x smaller than the camera original.
3. Strip EXIF. Phone photos carry the exact GPS coordinates of where the
   shutter fired. On a foraging site that is a spot giveaway, and it happens
   silently unless something removes it. This is not optional.

Note the order: EXIF orientation is applied to the pixels BEFORE the metadata
is discarded, otherwise portrait photos come out sideways.
"""
import io
import os

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

MAX_EDGE = 2000
QUALITY = 82


def to_web_image(django_file, max_edge=MAX_EDGE, quality=QUALITY):
    """
    Returns a ContentFile holding a resized, EXIF-free WebP.

    Animated GIFs collapse to their first frame -- acceptable for a photo
    blog, worth knowing if that ever changes.
    """
    django_file.seek(0)
    img = Image.open(django_file)

    # Bake rotation into the pixels while the EXIF tag still exists.
    img = ImageOps.exif_transpose(img)

    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGBA' if 'A' in img.getbands() else 'RGB')

    img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

    # Pillow copies these through to the output if left in place.
    for key in ('exif', 'xmp', 'photoshop', 'icc_profile'):
        img.info.pop(key, None)

    buffer = io.BytesIO()
    img.save(buffer, format='WEBP', quality=quality, method=6, exif=b'')
    buffer.seek(0)

    stem = os.path.splitext(os.path.basename(django_file.name))[0]
    return ContentFile(buffer.read(), name=f'{stem}.webp')


def is_new_upload(fieldfile):
    """
    True when this FieldFile holds a file that hasn't been written to storage
    yet -- i.e. someone just picked it in a form. Guards against re-encoding
    the same image on every unrelated save.
    """
    return bool(fieldfile) and not fieldfile._committed