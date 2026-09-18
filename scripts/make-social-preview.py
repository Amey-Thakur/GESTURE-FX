"""
File: scripts/make-social-preview.py
Author: Amey Thakur
GitHub: https://github.com/Amey-Thakur
Repository: https://github.com/Amey-Thakur/GESTURE-FX
Release Date: September 1 2026
License: MIT

Tech Stack: Python 3, Pillow

Description:
Draws the two social preview cards.

Both are generated rather than laid out by hand, so they can be regenerated when
the wordmark or a measured figure changes, and so their treatment matches the
product: the wordmark is separated into its colour channels by the same offsets
the chromatic split shader applies to a video frame.

There are two because the repository is two things to two readers. The first
card answers "what does it look like", with a row of eight frames of real
output cropped from the contact sheet the style harness writes, so the card
cannot advertise a look the shaders do not produce. The second answers "what is
the idea", with the scalar the detector actually watches, its samples, and the
interpolated zero between the two that bracket it. A reader who recognises the
second needs no other summary.

Both share one symmetric column about the vertical axis, one ground, and one
header, so they read as a pair rather than as two designs.

Nothing on either card is administrative. A licence badge or a repository URL
costs a reader attention and tells them nothing about the software.

Run:
    python scripts/make-social-preview.py
    python scripts/make-social-preview.py --light    the pair for a social feed

Reads:
    docs/screenshots/frame_styles.jpg        the contact sheet, eight panels

Writes:
    docs/screenshots/social_preview.png      1280 x 640, the media card
    docs/screenshots/social_preview_method.png   1280 x 640, the method card
    Source Code/public/social-preview.png    the copy the page links to
    .github/social-preview.png               the copy uploaded in settings
    .github/social-preview-method.png        the alternate, for posts about the method

With --light, the same two cards on a white ground, for a feed:
    docs/screenshots/social_preview_light.png
    docs/screenshots/social_preview_method_light.png
    .github/social-preview-light.png
    .github/social-preview-method-light.png
"""

from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

# --- Canvas ---------------------------------------------------------------
WIDTH, HEIGHT = 1280, 640
CENTRE = WIDTH // 2

# --- Palette, from styles/tokens.css --------------------------------------
INK_950 = (6, 7, 10)
INK_900 = (11, 13, 18)
CYAN = (46, 224, 251)
MAGENTA = (255, 77, 157)
TEXT_STRONG = (242, 245, 250)
TEXT_SECONDARY = (154, 165, 184)
TEXT_MUTED = (130, 141, 159)

# Drawn as white at a low alpha over a dark ground, so both invert with it.
FIELD = (255, 255, 255, 5)
HAIRLINE = (255, 255, 255, 28)

# --- The light palette, from the paper's own figure colours ----------------
#
# A dark card is right on a repository page and wrong in a feed, where a black
# rectangle in a white timeline reads as a hole. The interface cyan and magenta
# are too light to sit on white, which is why paper/main.tex declares a second
# pair for its figures; those are the ones used here, so a reader who has seen
# the paper recognises the card.
LIGHT_PALETTE = {
    'INK_950': (255, 255, 255),
    'INK_900': (238, 241, 246),      # panelFill
    'CYAN': (15, 166, 196),          # cyanAccent
    'MAGENTA': (214, 46, 126),       # magentaAccent
    'TEXT_STRONG': (11, 13, 18),
    'TEXT_SECONDARY': (74, 74, 85),  # inkMuted
    'TEXT_MUTED': (122, 132, 148),
    'FIELD': (0, 0, 0, 6),
    'HAIRLINE': (0, 0, 0, 38),
}


def use_light_palette() -> None:
    """Rebinds the palette in place, so every drawing function follows."""
    globals().update(LIGHT_PALETTE)

# The offset the chromatic split applies, scaled for display type.
SPLIT = 6

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT_CANDIDATES = {
    'bold': [
        r'C:\Windows\Fonts\segoeuib.ttf',
        r'C:\Windows\Fonts\arialbd.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    ],
    'regular': [
        r'C:\Windows\Fonts\segoeui.ttf',
        r'C:\Windows\Fonts\arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
    'italic': [
        r'C:\Windows\Fonts\segoeuii.ttf',
        r'C:\Windows\Fonts\ariali.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
    ],
}


def load_font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """Loads the first available face, so the script runs on any machine."""
    for path in FONT_CANDIDATES[weight]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)

    print(f'No {weight} font found; falling back to the bitmap default.', file=sys.stderr)
    return ImageFont.load_default()


def centred(draw: ImageDraw.ImageDraw, y: int, text: str, font, fill) -> None:
    """Draws text centred on the axis every element on the card shares."""
    box = draw.textbbox((0, 0), text, font=font)
    draw.text((CENTRE - (box[2] - box[0]) / 2 - box[0], y), text, font=font, fill=fill)


def draw_background(image: Image.Image) -> None:
    """A wash that is lightest on the axis, with a faint scanline field."""
    draw = ImageDraw.Draw(image)

    for y in range(HEIGHT):
        t = abs(y - HEIGHT / 2) / (HEIGHT / 2)
        colour = tuple(round(INK_900[i] + (INK_950[i] - INK_900[i]) * t) for i in range(3))
        draw.line([(0, y), (WIDTH, y)], fill=colour)

    overlay = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    scan = ImageDraw.Draw(overlay)

    for y in range(0, HEIGHT, 3):
        scan.line([(0, y), (WIDTH, y)], fill=FIELD)

    image.alpha_composite(overlay)


def draw_mark(image: Image.Image, cx: int, cy: int, size: int) -> None:
    """
    The application mark: a viewfinder frame split into its colour channels.

    Drawn straight onto the ground rather than onto a plate of its own. A plate
    is a second background, and a second background on a card that already has
    one reads as a pasted logo however carefully its colour is chosen.
    """
    overlay = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    half = size / 2
    box = (cx - half, cy - half, cx + half, cy + half)
    stroke = max(3, round(size * 0.11))
    offset = round(size * 0.10)
    radius = round(size * 0.26)

    # The two channels first, then the white frame over them, so the split
    # reads as one frame separated rather than as three frames.
    for shift, colour, alpha in ((-offset, CYAN, 235), (offset, MAGENTA, 235)):
        draw.rounded_rectangle(
            (box[0] + shift, box[1] + shift, box[2] + shift, box[3] + shift),
            radius=radius,
            outline=colour + (alpha,),
            width=stroke,
        )

    draw.rounded_rectangle(box, radius=radius, outline=TEXT_STRONG + (255,), width=stroke)

    image.alpha_composite(overlay)


def draw_split_title(image: Image.Image, y: int, text: str, font) -> None:
    """The wordmark, centred and separated into its colour channels."""
    box = ImageDraw.Draw(image).textbbox((0, 0), text, font=font)
    x = CENTRE - (box[2] - box[0]) / 2 - box[0]

    for shift, colour, alpha in (
        (-SPLIT, CYAN, 205),
        (SPLIT, MAGENTA, 205),
        (0, TEXT_STRONG, 255),
    ):
        layer = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text(
            (x + shift, y + round(shift * 0.4)),
            text,
            font=font,
            fill=colour + (alpha,),
        )
        image.alpha_composite(layer)


def draw_header(image: Image.Image, tagline: str) -> None:
    """The mark, the wordmark and one line, identical on both cards."""
    draw_mark(image, CENTRE, 50, 42)
    draw_split_title(image, 78, 'GESTURE-FX', load_font('bold', 66))

    centred(
        ImageDraw.Draw(image),
        166,
        tagline,
        load_font('regular', 26),
        TEXT_SECONDARY + (255,),
    )


def draw_footer(image: Image.Image, strapline: str) -> None:
    """One line of substance and the byline, identical on both cards."""
    draw = ImageDraw.Draw(image)

    centred(draw, 532, strapline, load_font('regular', 20), TEXT_SECONDARY + (255,))
    centred(draw, 572, 'Amey Thakur', load_font('bold', 23), TEXT_STRONG + (255,))


# The contact sheet the style harness writes: eight panels of 300 by 534, laid
# out with a ten pixel gap and a label strip beneath each.
SHEET = os.path.join(ROOT, 'docs', 'screenshots', 'frame_styles.jpg')
PANEL_WIDTH, PANEL_HEIGHT, PANEL_GAP = 300, 534, 10

# Every panel, in the order the sheet holds them, and what to call each on the
# card. The camera leads so a reader sees what the rest are made from, and none
# is left out: the card states a number of media, and a reader who counts the
# tiles should arrive at it.
HERO = [
    (0, 'CAMERA'),
    (1, 'CARTOON'),
    (2, 'PAINT'),
    (3, 'COMIC'),
    (4, 'POSTER'),
    (5, 'NEON'),
    (6, 'SKETCH'),
    (7, 'INK'),
]


def draw_hero(image: Image.Image, top: int, height: int) -> None:
    """
    Lays the eight frames in a symmetric row.

    Each is cropped to a portrait tile, rounded, and given a hairline so the
    darker media do not bleed into the ground.
    """
    if not os.path.exists(SHEET):
        print(f'{SHEET} is missing; run the style harness first.', file=sys.stderr)
        return

    sheet = Image.open(SHEET).convert('RGB')

    width = round(height * PANEL_WIDTH / PANEL_HEIGHT)
    gap = 10
    total = len(HERO) * width + (len(HERO) - 1) * gap
    x = CENTRE - total // 2

    label = load_font('bold', 13)
    draw = ImageDraw.Draw(image)

    for index, name in HERO:
        left = PANEL_GAP + index * (PANEL_WIDTH + PANEL_GAP)
        tile = sheet.crop((left, PANEL_GAP, left + PANEL_WIDTH, PANEL_GAP + PANEL_HEIGHT))
        tile = tile.resize((width, height), Image.LANCZOS)

        # A rounded corner, cut with a mask rather than drawn over, so the
        # ground shows through instead of a dark square sitting on it.
        mask = Image.new('L', (width, height), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=8, fill=255)
        image.paste(tile, (x, top), mask)

        draw.rounded_rectangle(
            (x, top, x + width - 1, top + height - 1),
            radius=8,
            outline=HAIRLINE,
            width=1,
        )

        box = draw.textbbox((0, 0), name, font=label)
        draw.text(
            (x + width / 2 - (box[2] - box[0]) / 2 - box[0], top + height + 12),
            name,
            font=label,
            fill=(CYAN + (255,)) if name != 'CAMERA' else (TEXT_MUTED + (255,)),
        )

        x += width + gap


# --- The method card ------------------------------------------------------

# Where the samples fall relative to the crossing. The tracker runs at 24 Hz and
# the zero does not land on a sampling instant, which is the whole point of the
# card: the two nearest samples straddle it and neither is it.
SAMPLE_PHASES = [-0.86, -0.63, -0.40, -0.17, 0.09, 0.32, 0.55, 0.78]


def draw_signal(image: Image.Image, cy: int, width: int, height: int) -> None:
    """
    The scalar the detector watches, and the zero it reports.

    This is the hero of the second card because it is the whole method in one
    shape. The curve starts positive with the palm toward the lens, crosses zero
    the instant the hand is edge-on, and settles negative with the back toward
    the lens. The dots are the instants the tracker actually observes. The two
    either side of the crossing are the bracket; the magenta mark between them
    is the reported instant, which lies where no sample does.
    """
    overlay = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    left = CENTRE - width // 2
    right = CENTRE + width // 2
    amplitude = height / 2

    def curve(phase: float) -> float:
        """s across the plot, in [-1, 1]: positive palm-on, negative back-on."""
        return math.cos(math.pi * (phase + 1) / 2)

    def to_x(phase: float) -> float:
        return CENTRE + phase * width / 2

    def to_y(value: float) -> float:
        return cy - value * amplitude

    # The zero line the curve crosses.
    for x in range(left, right, 9):
        draw.line([(x, cy), (x + 4, cy)], fill=(255, 255, 255, 34), width=1)

    points = [
        (to_x(-1 + 2 * step / width), to_y(curve(-1 + 2 * step / width)))
        for step in range(width + 1)
    ]

    # A halo under the curve, so it reads as lit rather than drawn.
    for glow_width, alpha in ((15, 20), (9, 38)):
        draw.line(points, fill=CYAN + (alpha,), width=glow_width, joint='curve')

    draw.line(points, fill=CYAN + (255,), width=4, joint='curve')

    # The crossing, marked on the axis every other element is centred on.
    draw.line(
        [(CENTRE, cy - amplitude - 34), (CENTRE, cy + amplitude + 34)],
        fill=MAGENTA + (80,),
        width=2,
    )

    image.alpha_composite(overlay)

    # The observed instants, drawn opaque over the curve.
    overlay = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    bracket = (SAMPLE_PHASES[3], SAMPLE_PHASES[4])

    for phase in SAMPLE_PHASES:
        x, y = to_x(phase), to_y(curve(phase))
        held = phase in bracket
        radius = 8 if held else 5

        if held:
            # A dropped line to the axis, so the reader sees which two values
            # the interpolation is weighted by.
            draw.line([(x, y), (x, cy)], fill=TEXT_MUTED + (110,), width=1)

        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=INK_950 + (255,),
            outline=(TEXT_STRONG if held else TEXT_MUTED) + (255,),
            width=3 if held else 2,
        )

    # The reported crossing: between the two samples, on neither.
    draw.ellipse((CENTRE - 19, cy - 19, CENTRE + 19, cy + 19), outline=MAGENTA + (110,), width=2)
    draw.ellipse((CENTRE - 9, cy - 9, CENTRE + 9, cy + 9), fill=MAGENTA + (255,))

    image.alpha_composite(overlay)

    # The two faces of the hand, labelled at the ends they belong to.
    draw = ImageDraw.Draw(image)
    small = load_font('regular', 18)

    draw.text(
        (left - 4, cy - amplitude - 30),
        'palm to lens',
        font=small,
        fill=TEXT_MUTED + (255,),
    )

    box = draw.textbbox((0, 0), 'back of hand', font=small)
    draw.text(
        (right - (box[2] - box[0]) + 4, cy + amplitude + 10),
        'back of hand',
        font=small,
        fill=TEXT_MUTED + (255,),
    )

    # The crossing, named directly beneath where it happens and clear of the
    # estimator set below it.
    label = load_font('bold', 17)
    box = draw.textbbox((0, 0), 'edge-on', font=label)
    draw.text(
        (CENTRE - (box[2] - box[0]) / 2 - box[0], cy + amplitude + 42),
        'edge-on',
        font=label,
        fill=MAGENTA + (255,),
    )


def build_media_card() -> Image.Image:
    """What it looks like."""
    image = Image.new('RGBA', (WIDTH, HEIGHT), INK_950 + (255,))
    draw_background(image)

    draw_header(image, 'Frame a shot with your hands.')
    draw_hero(image, top=214, height=244)
    draw_footer(image, 'Seven media  ·  On device  ·  Recorded, not previewed')

    return image


def build_method_card() -> Image.Image:
    """What the idea is."""
    image = Image.new('RGBA', (WIDTH, HEIGHT), INK_950 + (255,))
    draw_background(image)

    draw_header(image, 'A flip is a zero crossing of one scalar.')

    draw_signal(image, cy=336, width=760, height=144)

    draw = ImageDraw.Draw(image)

    # The quantity, then the estimator applied to it. Two lines, because the
    # second is only interesting once the first is understood.
    centred(
        draw,
        204,
        's(\u03b8) = k(\u03b8) cos \u03b8,    k > 0',
        load_font('italic', 27),
        TEXT_STRONG + (255,),
    )

    centred(
        draw,
        480,
        '\u03c4 = t\u2081 + (t\u2082 \u2212 t\u2081) \u00b7 |s\u2081| / (|s\u2081| + |s\u2082|)',
        load_font('italic', 25),
        CYAN + (255,),
    )

    draw_footer(image, '6.7 ms mean error  ·  0.16 frames  ·  0 false positives in 240')

    return image


def main() -> None:
    light = '--light' in sys.argv

    if light:
        use_light_palette()

    media = build_media_card().convert('RGB')
    method = build_method_card().convert('RGB')

    if light:
        # The dark cards keep their names, because GitHub and the application
        # page both link to them. The light pair is for a feed.
        targets = [
            (media, os.path.join(ROOT, 'docs', 'screenshots', 'social_preview_light.png')),
            (media, os.path.join(ROOT, '.github', 'social-preview-light.png')),
            (method, os.path.join(ROOT, 'docs', 'screenshots', 'social_preview_method_light.png')),
            (method, os.path.join(ROOT, '.github', 'social-preview-method-light.png')),
        ]
    else:
        targets = [
            (media, os.path.join(ROOT, 'docs', 'screenshots', 'social_preview.png')),
            (media, os.path.join(ROOT, 'Source Code', 'public', 'social-preview.png')),
            (media, os.path.join(ROOT, '.github', 'social-preview.png')),
            (method, os.path.join(ROOT, 'docs', 'screenshots', 'social_preview_method.png')),
            (method, os.path.join(ROOT, '.github', 'social-preview-method.png')),
        ]

    for image, target in targets:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        image.save(target, 'PNG', optimize=True)
        print(f'wrote {target}')


if __name__ == '__main__':
    main()
