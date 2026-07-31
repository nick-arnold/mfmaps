from django.http import Http404
from django.shortcuts import redirect, render

from .models import Post, PostType, PostTypeAlias


def index(request):
    """/blog/ -- everything, newest first."""
    posts = (
        Post.objects
        .visible_to(request.user)
        .select_related('post_type', 'author')
    )
    return render(request, 'blog/index.html', {
        'post_types': PostType.objects.all(),
        'posts': posts,
    })


def entry(request, slug):
    """
    /blog/<slug>/ -- post types and posts share one namespace, so this
    resolves in order: live post type, live post, retired post type slug.

    Model validation guarantees a slug can only belong to one of them,
    so the order here is about cost, not correctness.
    """
    post_type = PostType.objects.filter(slug=slug).first()
    if post_type is not None:
        posts = (
            post_type.posts
            .visible_to(request.user)
            .select_related('author')
        )
        return render(request, 'blog/post_type.html', {
            'post_type': post_type,
            'posts': posts,
        })

    post = (
        Post.objects
        .visible_to(request.user)
        .select_related('post_type', 'author')
        .filter(slug=slug)
        .first()
    )
    if post is not None:
        return render(request, 'blog/post.html', {'post': post})

    alias = (
        PostTypeAlias.objects
        .select_related('post_type')
        .filter(slug=slug)
        .first()
    )
    if alias is not None:
        return redirect(alias.post_type.get_absolute_url(), permanent=True)

    raise Http404(f'Nothing at /blog/{slug}/')