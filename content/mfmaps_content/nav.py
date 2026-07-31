"""
Site navigation — single source of truth.

Every main-nav item, every sub-nav item, and every section's legend colour is
defined here. Templates read this via the `nav_sections` context processor, so
adding or renaming a page is a one-line edit in this file.

Slot meanings are consistent across all four sections even though the labels
change:

    anatomy   — how the organism is built; the diagram page
    identify  — the ID tool
    handle    — what you do with it after you find it
    species   — ranges, seasonality, the real reference data
    lists     — editorial round-ups (archive; individual posts live under it)

Legend colours follow USGS topographic ink conventions: vegetation green,
contour brown, hydrographic blue. Fungi takes the brand ember.
"""

SECTIONS = {
    'flora': {
        'label': 'Flora',
        'blurb': 'Plants, berries, and greens worth walking for.',
        'color': '#4a7c3f',
        'pages': [
            ('anatomy',  'Plant Parts'),
            ('identify', 'ID Tool'),
            ('handle',   'Harvest & Prep'),
            ('species',  'Ranges & Seasons'),
            ('lists',    'Field Notes'),
        ],
    },
    'fauna': {
        'label': 'Fauna',
        'blurb': 'Animals, tracks, and the sign they leave behind.',
        'color': '#8a5a2b',
        'pages': [
            ('anatomy',  'Anatomy & Sign'),
            ('identify', 'Track ID'),
            ('handle',   'Field Dressing'),
            ('species',  'Ranges & Seasons'),
            ('lists',    'Field Notes'),
        ],
    },
    'fungi': {
        'label': 'Fungi',
        'blurb': 'Mushrooms first — morels, chanterelles, matsutake.',
        'color': '#d96d2a',
        'pages': [
            ('anatomy',  'Mushroom Diagram'),
            ('identify', 'ID Tool'),
            ('handle',   'Preservation & Prep'),
            ('species',  'Ranges & Seasonality'),
            ('lists',    'Field Notes'),
        ],
    },
    'fish': {
        'label': 'Fish',
        'blurb': 'Freshwater, coastal, and the runs that time them.',
        'color': '#2f6f8f',
        'pages': [
            ('anatomy',  'Fish Anatomy'),
            ('identify', 'ID Tool'),
            ('handle',   'Cleaning & Prep'),
            ('species',  'Ranges & Runs'),
            ('lists',    'Field Notes'),
        ],
    },
}

# Main nav order. Dicts preserve insertion order in Python 3.7+, but being
# explicit means reordering the nav never depends on dict literal order.
SECTION_ORDER = ['flora', 'fauna', 'fungi', 'fish']


def ordered_sections():
    """[(slug, data), ...] in main-nav order."""
    return [(slug, SECTIONS[slug]) for slug in SECTION_ORDER]
