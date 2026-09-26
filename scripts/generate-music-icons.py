"""Generate crisp, monochrome 128 px Discord application emoji icons.

Requires Pillow: python -m pip install pillow
"""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets" / "music-icons"
OUT.mkdir(parents=True, exist_ok=True)
S = 4
WHITE = (244, 247, 255, 255)


def point(coords):
    return [(int(x * S), int(y * S)) for x, y in coords]


def render(name, draw_icon):
    image = Image.new("RGBA", (128 * S, 128 * S), (0, 0, 0, 0))
    draw_icon(ImageDraw.Draw(image))
    image.resize((128, 128), Image.Resampling.LANCZOS).save(OUT / f"{name}.png", optimize=True)


def play(d):
    d.polygon(point([(43, 29), (100, 64), (43, 99)]), fill=WHITE)


def pause(d):
    d.rounded_rectangle((36*S, 30*S, 54*S, 98*S), radius=5*S, fill=WHITE)
    d.rounded_rectangle((74*S, 30*S, 92*S, 98*S), radius=5*S, fill=WHITE)


def skip(d):
    d.polygon(point([(26, 31), (72, 64), (26, 97)]), fill=WHITE)
    d.rounded_rectangle((79*S, 31*S, 96*S, 97*S), radius=4*S, fill=WHITE)


def stop(d):
    d.rounded_rectangle((31*S, 31*S, 97*S, 97*S), radius=9*S, fill=WHITE)


def queue(d):
    for y in (37, 64, 91):
        d.ellipse((25*S, (y-5)*S, 35*S, (y+5)*S), fill=WHITE)
        d.rounded_rectangle((46*S, (y-5)*S, 104*S, (y+5)*S), radius=5*S, fill=WHITE)


def minus(d):
    d.rounded_rectangle((27*S, 57*S, 101*S, 71*S), radius=7*S, fill=WHITE)


def plus(d):
    minus(d)
    d.rounded_rectangle((57*S, 27*S, 71*S, 101*S), radius=7*S, fill=WHITE)


for name, icon in (("resume", play), ("pause", pause), ("skip", skip),
                   ("stop", stop), ("queue", queue), ("volume_down", minus),
                   ("volume_up", plus)):
    render(name, icon)
