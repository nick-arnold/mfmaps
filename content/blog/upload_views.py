"""
Upload endpoint for the markdown editor's image button.

Response shape is dictated by EasyMDE, which expects either
    {"data": {"filePath": "<url>"}}
or
    {"error": "<message>"}

Staff-only, and every upload is recorded as a BlogImage row so the admin
keeps a browsable library. Resizing and EXIF stripping happen in
BlogImage.save() -- see blog/imaging.py.
"""
import logging

from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import BlogImage

logger = logging.getLogger('blog')

MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Matches what nginx will accept and what Pillow can open. Anything else is
# rejected before it reaches the decoder.
ALLOWED_CONTENT_TYPES = {
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
}


@require_POST
@staff_member_required
def upload_image(request):
    upload = request.FILES.get('image')
    if upload is None:
        return JsonResponse({'error': 'No file was received.'}, status=400)

    if upload.size > MAX_UPLOAD_BYTES:
        return JsonResponse(
            {'error': 'That image is larger than 25 MB.'},
            status=400,
        )

    if upload.content_type not in ALLOWED_CONTENT_TYPES:
        return JsonResponse(
            {'error': f'{upload.content_type} is not a supported image type.'},
            status=400,
        )

    try:
        record = BlogImage(image=upload, uploaded_by=request.user)
        record.save()
    except Exception:
        # iPhone HEIC without a decoder, truncated file, storage refusing the
        # write -- all land here. The traceback goes to the log; the editor
        # gets something a person can act on.
        logger.exception('Blog image upload failed')
        return JsonResponse(
            {'error': 'That image could not be processed. Try a JPEG or PNG.'},
            status=500,
        )

    return JsonResponse({'data': {'filePath': record.image.url}})