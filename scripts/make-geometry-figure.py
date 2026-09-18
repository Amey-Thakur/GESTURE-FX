"""
File: scripts/make-geometry-figure.py
Author: Amey Thakur
GitHub: https://github.com/Amey-Thakur
Repository: https://github.com/Amey-Thakur/GESTURE-FX
Release Date: August 31 2026
License: MIT

Tech Stack: Python 3, Pillow

Description:
Draws the figure that explains the detector.

Three panels show the palm triangle at three rotations about the hand's long
axis, under orthographic projection. The triangle's winding order reverses
between the first and third, and its projected area vanishes in the second.

The geometry is computed, not drawn by eye: the landmark positions are rotated
and projected by the same arithmetic the detector uses, and the printed value of
s is the value the detector would read. If the derivation were wrong, this
figure would show it.

Run:
    python scripts/make-geometry-figure.py

Writes:
    docs/screenshots/geometry.png
    docs/screenshots/geometry_light.png    with --light, for a social feed
"""

from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1180, 430
PANEL_W = WIDTH // 3

INK_950 = (6, 7, 10)
INK_900 = (11, 13, 18)
CYAN = (46, 224, 251)
MAGENTA = (255, 77, 157)
TEXT_STRONG = (242, 245, 250)
TEXT_SECONDARY = (154, 165, 184)
TEXT_MUTED = (130, 141, 159)
SKIN = (232, 195, 158)

# The separator is white at a low alpha, and the palm slab is a wash that needs
# more of itself to show on white than on black, so both move with the palette.
RULE = (255, 255, 255, 18)
SLAB_FILL, SLAB_EDGE = 34, 90

# --- The light palette, from the paper's own figure colours ----------------
#
# Figure 1 of the paper is this drawing, and the paper declares its own pair of
# accents for a white page because the interface cyan and magenta are too light
# to read on one. Those are used here, so the light figure and the paper agree.
LIGHT_PALETTE = {
    'INK_950': (255, 255, 255),
    'INK_900': (238, 241, 246),      # panelFill
    'CYAN': (15, 166, 196),          # cyanAccent
    'MAGENTA': (214, 46, 126),       # magentaAccent
    'TEXT_STRONG': (11, 13, 18),
    'TEXT_SECONDARY': (74, 74, 85),  # inkMuted
    'TEXT_MUTED': (122, 132, 148),
    'SKIN': (198, 150, 104),
    'RULE': (0, 0, 0, 28),
    'SLAB_FILL': 52,
    'SLAB_EDGE': 130,
}


def use_light_palette() -> None:
    """Rebinds the palette in place, so every drawing function follows."""
    globals().update(LIGHT_PALETTE)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONTS = {
    'bold': [r'C:\Windows\Fonts\segoeuib.ttf', r'C:\Windows\Fonts\arialbd.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
    'regular': [r'C:\Windows\Fonts\segoeui.ttf', r'C:\Windows\Fonts\arial.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    'mono': [r'C:\Windows\Fonts\consola.ttf', r'C:\Windows\Fonts\cour.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'],
}


def font(kind: str, size: int):
    for path in FONTS[kind]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    print(f'no {kind} font found', file=sys.stderr)
    return ImageFont.load_default()


# --- The hand model -------------------------------------------------------
#
# Three landmarks on the palm plane, in hand-local coordinates: x to the
# thumb side, y toward the fingers, z out of the palm. Only their arrangement
# matters, not their exact values.
LANDMARKS = {
    'P0': (0.00, -1.00),    # wrist
    'P5': (0.55, 0.55),     # index knuckle
    'P17': (-0.55, 0.45),   # little finger knuckle
}


def project(point: tuple[float, float], theta: float) -> tuple[float, float]:
    """Rotates about the hand's long axis, then projects orthographically."""
    x, y = point
    return x * math.cos(theta), y


def palm_sign(theta: float) -> float:
    """The detector's scalar, computed exactly as features.ts computes it."""
    p0 = project(LANDMARKS['P0'], theta)
    p5 = project(LANDMARKS['P5'], theta)
    p17 = project(LANDMARKS['P17'], theta)

    v1 = (p5[0] - p0[0], p5[1] - p0[1])
    v2 = (p17[0] - p0[0], p17[1] - p0[1])

    cross = v1[0] * v2[1] - v1[1] * v2[0]
    denominator = math.hypot(*v1) * math.hypot(*v2)

    return 0.0 if denominator < 1e-9 else cross / denominator


def to_screen(point: tuple[float, float], cx: int, cy: int, scale: float) -> tuple[float, float]:
    return cx + point[0] * scale, cy - point[1] * scale


def draw_panel(image: Image.Image, index: int, theta: float, caption: str, highlight: bool) -> None:
    draw = ImageDraw.Draw(image, 'RGBA')

    x0 = index * PANEL_W
    cx = x0 + PANEL_W // 2
    cy = 196
    scale = 74.0

    accent = MAGENTA if highlight else CYAN

    # Panel separator.
    if index > 0:
        draw.line([(x0, 30), (x0, HEIGHT - 30)], fill=RULE, width=1)

    points = {name: to_screen(project(p, theta), cx, cy, scale) for name, p in LANDMARKS.items()}

    # The palm, as a translucent slab, so the triangle is read against a hand.
    width = abs(math.cos(theta))
    if width > 0.02:
        draw.rounded_rectangle(
            (cx - 76 * width, cy - 92, cx + 76 * width, cy + 78),
            radius=max(4, int(26 * width)),
            fill=SKIN + (SLAB_FILL,),
            outline=SKIN + (SLAB_EDGE,),
            width=2,
        )
    else:
        draw.line([(cx, cy - 92), (cx, cy + 78)], fill=SKIN + (150,), width=3)

    # The triangle.
    triangle = [points['P0'], points['P5'], points['P17']]
    draw.polygon(triangle, fill=accent + (34,), outline=accent + (220,))

    for a, b in ((0, 1), (0, 2), (1, 2)):
        draw.line([triangle[a], triangle[b]], fill=accent + (230,), width=3)

    # Winding direction, drawn as an arc with an arrowhead, omitted when the
    # triangle has collapsed and has no orientation to show.
    if abs(palm_sign(theta)) > 0.05:
        radius = 30
        clockwise = palm_sign(theta) < 0
        start, end = (200, 340) if clockwise else (-160, 20)
        draw.arc((cx - radius, cy - radius + 4, cx + radius, cy + radius + 4),
                 start=start, end=end, fill=TEXT_SECONDARY + (200,), width=3)

        tip_angle = math.radians(end)
        tx = cx + radius * math.cos(tip_angle)
        ty = cy + 4 + radius * math.sin(tip_angle)
        size = 7
        direction = -1 if clockwise else 1
        draw.polygon(
            [(tx, ty - size * direction), (tx - size, ty + size * direction), (tx + size, ty + size * direction)],
            fill=TEXT_SECONDARY + (220,),
        )

    # Landmark dots and labels.
    label_font = font('mono', 15)
    for name, position in points.items():
        px, py = position
        draw.ellipse((px - 6, py - 6, px + 6, py + 6), fill=TEXT_STRONG + (255,))
        offset = (12, -22) if name != 'P17' else (-46, -22)
        draw.text((px + offset[0], py + offset[1]), name, font=label_font, fill=TEXT_SECONDARY + (255,))

    # Readout.
    value = palm_sign(theta)
    angle_font = font('regular', 19)
    value_font = font('mono', 25)
    caption_font = font('regular', 16)

    def centred(y: int, text: str, f, fill):
        box = draw.textbbox((0, 0), text, font=f)
        draw.text((cx - (box[2] - box[0]) / 2 - box[0], y), text, font=f, fill=fill)

    centred(46, f'theta = {round(math.degrees(theta))}\u00b0', angle_font, TEXT_MUTED + (255,))
    centred(324, f's = {value:+.3f}', value_font, accent + (255,))
    centred(362, caption, caption_font, TEXT_SECONDARY + (255,))

    if highlight:
        centred(392, 'TRIGGER', font('bold', 15), MAGENTA + (255,))


def main() -> None:
    light = '--light' in sys.argv

    if light:
        use_light_palette()

    image = Image.new('RGB', (WIDTH, HEIGHT), INK_950)
    draw = ImageDraw.Draw(image)

    for y in range(HEIGHT):
        t = abs(y - HEIGHT / 2) / (HEIGHT / 2)
        draw.line([(0, y), (WIDTH, y)],
                  fill=tuple(round(INK_900[i] + (INK_950[i] - INK_900[i]) * t) for i in range(3)))

    draw_panel(image, 0, 0.0, 'palm toward the camera', False)
    draw_panel(image, 1, math.pi / 2, 'edge-on: the triangle has no area', True)
    draw_panel(image, 2, math.pi, 'back toward the camera: winding reversed', False)

    name = 'geometry_light.png' if light else 'geometry.png'
    target = os.path.join(ROOT, 'docs', 'screenshots', name)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    image.save(target, 'PNG', optimize=True)

    print(f'wrote {target}')
    print('\nComputed values, which the figure prints:')
    for degrees in (0, 45, 90, 135, 180):
        print(f'  theta = {degrees:3d}deg   s = {palm_sign(math.radians(degrees)):+.4f}')


if __name__ == '__main__':
    main()
