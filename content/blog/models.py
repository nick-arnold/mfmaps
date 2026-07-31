from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.urls import reverse
from django.utils import timezone

from .imaging import is_new_upload, to_web_image


# Post slugs and post-type slugs share the /blog/ namespace, so a post called
# "outings" would shadow the Outings index page. Both are validated against
# this list and against each other.
RESERVED_SLUGS = {
    'feed', 'rss', 'atom', 'page', 'tag', 'tags',
    'search', 'archive', 'index', 'sitemap', 'preview', 'upload-image',
}


def validate_not_reserved(value):
    if value.lower() in RESERVED_SLUGS:
        raise ValidationError(f'"{value}" is reserved and cannot be used as a slug.')


class PostType(models.Model):
    """
    A grouping of posts with its own index page at /blog/<slug>/.
    Rows are added and edited in the admin -- no deploy needed.
    """
    name = models.CharField(max_length=100)
    slug = models.SlugField(
        max_length=100,
        unique=True,
        validators=[validate_not_reserved],
        help_text='Appears in the URL: /blog/<slug>/. If you change this, add '
                  'an alias for the old slug or existing links will break.',
    )
    intro = models.TextField(
        blank=True,
        help_text='Markdown. Shown at the top of this index page.',
    )
    meta_description = models.CharField(
        max_length=200,
        blank=True,
        help_text='Search-result snippet for this index page.',
    )
    order = models.PositiveIntegerField(
        default=0,
        help_text='Lower numbers appear first.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']
        verbose_name = 'post type'

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if not self.slug:
            return
        if Post.objects.filter(slug__iexact=self.slug).exists():
            raise ValidationError(
                {'slug': f'A post already uses the slug "{self.slug}".'}
            )
        if PostTypeAlias.objects.filter(slug__iexact=self.slug).exists():
            raise ValidationError(
                {'slug': f'A retired slug alias already uses "{self.slug}".'}
            )

    def get_absolute_url(self):
        return reverse('blog:entry', kwargs={'slug': self.slug})


class PostTypeAlias(models.Model):
    """
    A retired post-type slug. /blog/<old-slug>/ redirects permanently to the
    post type's current URL, so renaming never orphans an inbound link.
    """
    post_type = models.ForeignKey(
        PostType,
        on_delete=models.CASCADE,
        related_name='aliases',
    )
    slug = models.SlugField(
        max_length=100,
        unique=True,
        validators=[validate_not_reserved],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['slug']
        verbose_name = 'post type alias'
        verbose_name_plural = 'post type aliases'

    def __str__(self):
        return f'{self.slug} -> {self.post_type.slug}'

    def clean(self):
        super().clean()
        if not self.slug:
            return
        if PostType.objects.filter(slug__iexact=self.slug).exists():
            raise ValidationError(
                {'slug': f'"{self.slug}" is a live post type slug.'}
            )
        if Post.objects.filter(slug__iexact=self.slug).exists():
            raise ValidationError(
                {'slug': f'A post already uses the slug "{self.slug}".'}
            )


class PostQuerySet(models.QuerySet):
    def published(self):
        """Live posts only -- excludes drafts and future-dated posts."""
        return self.filter(
            status=Post.Status.PUBLISHED,
            published_at__lte=timezone.now(),
        )

    def visible_to(self, user):
        """Everything if the user can preview drafts, otherwise live only."""
        if user.is_authenticated and user.has_perm('blog.view_draft'):
            return self
        return self.published()


class Post(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        IN_REVIEW = 'in_review', 'In review'
        PUBLISHED = 'published', 'Published'

    title = models.CharField(max_length=200)
    slug = models.SlugField(
        max_length=200,
        unique=True,
        validators=[validate_not_reserved],
        help_text='Permanent. Lives at /blog/<slug>/ -- changing it breaks '
                  'every existing link to this post.',
    )
    post_type = models.ForeignKey(
        PostType,
        on_delete=models.PROTECT,
        related_name='posts',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='blog_posts',
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )

    body = models.TextField(help_text='Markdown.')
    excerpt = models.TextField(
        blank=True,
        help_text='Short summary for index pages and feeds. Falls back to the '
                  'opening of the body if left empty.',
    )

    hero_image = models.ImageField(
        upload_to='blog/hero/%Y/%m/',
        blank=True,
        null=True,
    )
    hero_alt = models.CharField(
        max_length=200,
        blank=True,
        help_text='Describe the image for screen readers and search engines.',
    )

    meta_description = models.CharField(
        max_length=200,
        blank=True,
        help_text='Search-result snippet. Falls back to the excerpt if empty.',
    )

    published_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Stamped automatically on first publish. Edit to backdate, '
                  'or set a future time to schedule.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = PostQuerySet.as_manager()

    class Meta:
        ordering = ['-published_at', '-created_at']
        indexes = [
            models.Index(fields=['status', '-published_at']),
            models.Index(fields=['post_type', 'status', '-published_at']),
        ]
        permissions = [
            ('view_draft', 'Can view unpublished posts on the live site'),
        ]

    def __str__(self):
        return self.title

    def clean(self):
        super().clean()
        if self.slug:
            if PostType.objects.filter(slug__iexact=self.slug).exists():
                raise ValidationError({'slug': f'"{self.slug}" is a post type URL.'})
            if PostTypeAlias.objects.filter(slug__iexact=self.slug).exists():
                raise ValidationError({'slug': f'"{self.slug}" is a retired post type URL.'})
        if self.hero_image and not self.hero_alt:
            raise ValidationError(
                {'hero_alt': 'Alt text is required when there is a hero image.'}
            )

    def save(self, *args, **kwargs):
        if self.status == self.Status.PUBLISHED and self.published_at is None:
            self.published_at = timezone.now()
        if is_new_upload(self.hero_image):
            self.hero_image = to_web_image(self.hero_image)
        super().save(*args, **kwargs)

    @property
    def is_live(self):
        return (
            self.status == self.Status.PUBLISHED
            and self.published_at is not None
            and self.published_at <= timezone.now()
        )

    def get_absolute_url(self):
        return reverse('blog:entry', kwargs={'slug': self.slug})


class BlogImage(models.Model):
    """
    An image uploaded from the editor and referenced inside post markdown.
    Stored as a row so uploads stay listable and re-findable in the admin.
    Resizing and EXIF stripping are wired up in a later step.
    """
    image = models.ImageField(upload_to='blog/body/%Y/%m/')
    alt = models.CharField(
        max_length=200,
        blank=True,
        help_text='Describe the image for screen readers and search engines.',
    )
    caption = models.CharField(max_length=300, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='blog_images',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if is_new_upload(self.image):
            self.image = to_web_image(self.image)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.alt or self.image.name