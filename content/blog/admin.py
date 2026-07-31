from django.contrib import admin
from django.utils.html import format_html

from .models import BlogImage, Post, PostType, PostTypeAlias


class PostTypeAliasInline(admin.TabularInline):
    model = PostTypeAlias
    extra = 0
    fields = ['slug']
    verbose_name = 'retired slug'
    verbose_name_plural = 'retired slugs (old URLs that should redirect here)'


@admin.register(PostType)
class PostTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'post_count', 'order']
    list_editable = ['order']
    prepopulated_fields = {'slug': ('name',)}
    inlines = [PostTypeAliasInline]
    fieldsets = [
        (None, {
            'fields': ['name', 'slug', 'order'],
        }),
        ('Index page', {
            'fields': ['intro', 'meta_description'],
            'description': 'Shown on the listing page for this post type.',
        }),
    ]

    @admin.display(description='posts')
    def post_count(self, obj):
        return obj.posts.count()


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ['title', 'post_type', 'status', 'author', 'published_at']
    list_filter = ['status', 'post_type', 'author']
    search_fields = ['title', 'body']
    prepopulated_fields = {'slug': ('title',)}
    date_hierarchy = 'published_at'
    ordering = ['-created_at']
    readonly_fields = ['created_at', 'updated_at', 'view_link']

    fieldsets = [
        (None, {
            'fields': ['title', 'slug', 'post_type', 'status', 'view_link'],
        }),
        ('Content', {
            'fields': ['body', 'excerpt'],
        }),
        ('Header image', {
            'fields': ['hero_image', 'hero_alt'],
            'classes': ['collapse'],
        }),
        ('Search engines', {
            'fields': ['meta_description'],
            'classes': ['collapse'],
        }),
        ('Dates and author', {
            'fields': ['author', 'published_at', 'created_at', 'updated_at'],
            'classes': ['collapse'],
        }),
    ]

    @admin.display(description='preview')
    def view_link(self, obj):
        if not obj.pk:
            return '— save first —'
        return format_html(
            '<a href="{}" target="_blank">open this post on the site</a>',
            obj.get_absolute_url(),
        )

    def get_changeform_initial_data(self, request):
        return {'author': request.user.pk}

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('post_type', 'author')


@admin.register(BlogImage)
class BlogImageAdmin(admin.ModelAdmin):
    list_display = ['thumbnail', 'alt', 'uploaded_by', 'created_at']
    list_display_links = ['thumbnail', 'alt']
    search_fields = ['alt', 'caption']
    readonly_fields = ['uploaded_by', 'created_at']

    @admin.display(description='image')
    def thumbnail(self, obj):
        if not obj.image:
            return '—'
        return format_html(
            '<img src="{}" style="height:40px;width:auto;border-radius:4px;">',
            obj.image.url,
        )

    def save_model(self, request, obj, form, change):
        if not obj.uploaded_by:
            obj.uploaded_by = request.user
        super().save_model(request, obj, form, change)