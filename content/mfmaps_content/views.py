from django.http import Http404, HttpResponse
from django.shortcuts import render

from .nav import SECTIONS


def home(request):
    return render(request, 'home.html')


def about(request):
    return render(request, 'about.html')


def _section_or_404(section):
    try:
        return SECTIONS[section]
    except KeyError:
        raise Http404(f'No section named {section!r}')


def section_landing(request, section):
    data = _section_or_404(section)
    return render(request, 'section_landing.html', {
        'section': section,
        'section_data': data,
    })


def section_page(request, section, page):
    data = _section_or_404(section)
    labels = dict(data['pages'])
    if page not in labels:
        raise Http404(f'No page named {page!r} in section {section!r}')
    return render(request, 'section_page.html', {
        'section': section,
        'section_data': data,
        'page': page,
        'page_label': labels[page],
    })


def robots_txt(request):
    return HttpResponse(
        "User-agent: *\nDisallow: /\n",
        content_type="text/plain",
    )
