"""
Markdown -> HTML for post bodies and post-type intros.

Sanitized with nh3 even though every author is a trusted staff member.
Two reasons: an editor pasting from Word or a website drags in tag soup
that would otherwise break the page layout, and if an author account is
ever compromised the blast radius stays small.

Widen ALLOWED_TAGS deliberately when you hit something you actually need,
not preemptively.
"""
import markdown as markdown_lib
import nh3
from django import template
from django.utils.safestring import mark_safe

register = template.Library()

ALLOWED_TAGS = {
    'p', 'br', 'hr',
    'h2', 'h3', 'h4',
    'strong', 'em', 'del', 'sub', 'sup',
    'blockquote', 'code', 'pre',
    'ul', 'ol', 'li',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
}

ALLOWED_ATTRIBUTES = {
    'a': {'href', 'title'},
    'img': {'src', 'alt', 'title', 'width', 'height', 'loading'},
    'td': {'colspan', 'rowspan'},
    'th': {'colspan', 'rowspan', 'scope'},
    'code': {'class'},
}

URL_SCHEMES = {'http', 'https', 'mailto'}

EXTENSIONS = [
    'extra',        # tables, fenced code, footnotes, attribute lists
    'sane_lists',   # a list needs a blank line before it -- fewer surprises
    'smarty',       # straight quotes become curly, -- becomes an en dash
]


@register.filter
def render_markdown(value):
    if not value:
        return ''
    html = markdown_lib.markdown(
        value,
        extensions=EXTENSIONS,
        output_format='html',
    )
    clean = nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=URL_SCHEMES,
    )
    return mark_safe(clean)