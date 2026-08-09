# -*- coding: utf-8 -*-
"""
Regenerates frontend/Fonts/ so VRCNext never needs fonts.googleapis.com at runtime.

  python tools/fetch-fonts.py

Downloads every UI font offered in Settings > Appearance > Fonts, plus a copy of
Material Symbols Rounded subsetted down to the icons the frontend actually uses.
Run it again whenever a new icon or a new font is added.

Requires: python -m pip install fonttools brotli uharfbuzz
"""

import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND  = os.path.join(ROOT, "frontend")
OUT_DIR   = os.path.join(FRONTEND, "Fonts")
FILES_DIR = os.path.join(OUT_DIR, "files")
CSS_PATH  = os.path.join(OUT_DIR, "fonts.css")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

ICON_FAMILY = "Material Symbols Rounded"
ICON_AXES   = "opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
ICON_FILE   = "material-symbols-rounded.woff2"

KEEP_SUBSETS = ["latin", "latin-ext", "cyrillic", "cyrillic-ext",
                "greek", "greek-ext", "vietnamese", "symbols"]

FONTS = [
    ("google-sans",  "Google Sans",      "Google Sans",      "wght@400;500;700"),
    ("google-mono",  "Google Sans Mono", "Google Sans Mono", "wght@400;500;700"),
    ("inter",        "Inter",            "Inter",            "wght@100..900"),
    ("roboto",       "Roboto",           "Roboto",           "wght@100..900"),
    ("open-sans",    "Open Sans",        "Open Sans",        "wght@300..800"),
    ("lato",         "Lato",             "Lato",             "wght@400;700;900"),
    ("montserrat",   "Montserrat",       "Montserrat",       "wght@100..900"),
    ("poppins",      "Poppins",          "Poppins",          "wght@300;400;500;600;700"),
    ("nunito",       "Nunito",           "Nunito",           "wght@200..1000"),
    ("rubik",        "Rubik",            "Rubik",            "wght@300..900"),
    ("manrope",      "Manrope",          "Manrope",          "wght@200..800"),
    ("quicksand",    "Quicksand",        "Quicksand",        "wght@300..700"),
]


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else data.decode("utf-8")


def css_url(family, axes, extra=None):
    q = [("family", family + ":" + axes if axes else family), ("display", "swap")]
    if extra:
        q.extend(extra)
    return "https://fonts.googleapis.com/css2?" + urllib.parse.urlencode(q)


def parse_faces(css):
    """Returns [(subset, body)] for every @font-face block, subset from the /* x */ comment."""
    out = []
    for m in re.finditer(r"(?:/\*\s*(\S+)\s*\*/\s*)?@font-face\s*\{(.*?)\}", css, re.S):
        out.append((m.group(1) or "latin", m.group(2)))
    return out


def face_field(body, name, default=""):
    m = re.search(name + r":\s*([^;]+);", body)
    return m.group(1).strip() if m else default


def collect_used_icons():
    """
    Every Material Symbols ligature name that appears as a bare word anywhere in the
    frontend. Deliberately a superset: a false positive costs a few bytes, a false
    negative renders the raw word instead of the icon.
    """
    meta = fetch("https://fonts.google.com/metadata/icons?incomplete=1&key=material_symbols")
    meta = json.loads(meta[meta.index("{"):])
    all_names = {i["name"] for i in meta["icons"]}

    used = set()
    for base, dirs, files in os.walk(FRONTEND):
        dirs[:] = [d for d in dirs if d not in ("Fonts", "node_modules", ".git")]
        for f in files:
            if not f.lower().endswith((".html", ".js", ".css")):
                continue
            src = io.open(os.path.join(base, f), encoding="utf-8", errors="ignore").read()
            for w in set(re.findall(r"[a-z][a-z0-9_]{1,40}", src)):
                if w in all_names:
                    used.add(w)
    return sorted(used), {i["name"]: i["codepoint"] for i in meta["icons"]}


def _cp(value):
    return value if isinstance(value, int) else int(str(value), 16)


def subset_icons():
    from fontTools import subset
    from fontTools.ttLib import TTFont

    names, codepoints = collect_used_icons()
    print("  icons kept: %d of %d" % (len(names), len(codepoints)))

    css = fetch(css_url(ICON_FAMILY, ICON_AXES))
    url = re.search(r"url\((\S+?)\)", css).group(1)
    raw = fetch(url, binary=True)
    print("  full font: %.1f MB" % (len(raw) / 1048576.0))

    src = io.BytesIO(raw)
    font = TTFont(src, fontNumber=0)
    font.flavor = None

    ligature_chars = ("abcdefghijklmnopqrstuvwxyz"
                      "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                      "0123456789_")
    unicodes = {ord(c) for c in ligature_chars}
    unicodes.update(_cp(codepoints[n]) for n in names)

    opts = subset.Options()
    opts.layout_features = ["rlig", "rclt"]
    opts.layout_closure  = False
    opts.name_IDs        = ["*"]
    opts.name_legacy     = True
    opts.notdef_outline  = True
    opts.recalc_bounds   = True
    opts.drop_tables    += ["DSIG"]

    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    out = os.path.join(FILES_DIR, ICON_FILE)
    check = out + ".ttf"
    font.flavor = None
    font.save(check)
    font.flavor = "woff2"
    font.save(out)

    forms = names + [n.upper() for n in names]
    bad = verify_ligatures(check, forms)
    os.remove(check)
    if bad:
        raise SystemExit("Subset broke %d ligatures, e.g. %s" % (len(bad), bad[:5]))

    print("  subset font: %.0f KB, %d ligatures verified (lower + upper) -> %s"
          % (os.path.getsize(out) / 1024.0, len(forms), ICON_FILE))
    return len(names)


def verify_ligatures(ttf_path, names):
    """Shapes every icon name and reports the ones that do not collapse to a single glyph."""
    import uharfbuzz as hb

    face = hb.Face(hb.Blob.from_file_path(ttf_path))
    font = hb.Font(face)
    bad = []
    for n in names:
        buf = hb.Buffer()
        buf.add_str(n)
        buf.guess_segment_properties()
        hb.shape(font, buf, {})
        infos = buf.glyph_infos
        if len(infos) != 1 or infos[0].codepoint == 0:
            bad.append(n)
    return bad


def fetch_family(font_id, css_family, google_family, axes):
    css = fetch(css_url(google_family, axes))
    faces = parse_faces(css)
    blocks = []
    total = 0
    seen = {}
    for subset_name, body in faces:
        if subset_name not in KEEP_SUBSETS:
            continue
        url = re.search(r"url\((\S+?)\)", body)
        if not url:
            continue
        weight = face_field(body, "font-weight", "400")
        style = face_field(body, "font-style", "normal")
        rng = face_field(body, "unicode-range")

        key = url.group(1)
        if key in seen:
            fname = seen[key]
        else:
            fname = "%s-%s-%s.woff2" % (font_id, subset_name, weight.replace(" ", "-"))
            data = fetch(key, binary=True)
            io.open(os.path.join(FILES_DIR, fname), "wb").write(data)
            seen[key] = fname
            total += len(data)

        block = ["@font-face {",
                 "    font-family: '%s';" % css_family,
                 "    font-style: %s;" % style,
                 "    font-weight: %s;" % weight,
                 "    font-display: swap;",
                 "    src: url('files/%s') format('woff2');" % fname]
        if rng:
            block.append("    unicode-range: %s;" % rng)
        block.append("}")
        blocks.append("\n".join(block))

    print("  %-12s %2d files, %5.0f KB" % (font_id, len(seen), total / 1024.0))
    return blocks


def main():
    try:
        import fontTools   # noqa: F401
        import brotli      # noqa: F401
        import uharfbuzz   # noqa: F401
    except ImportError:
        print("Missing dependencies. Run: python -m pip install fonttools brotli uharfbuzz")
        return 1

    os.makedirs(FILES_DIR, exist_ok=True)
    for f in os.listdir(FILES_DIR):
        os.remove(os.path.join(FILES_DIR, f))

    print("Material Symbols Rounded:")
    icon_count = subset_icons()

    print("UI fonts:")
    sections = []
    for font_id, css_family, google_family, axes in FONTS:
        blocks = fetch_family(font_id, css_family, google_family, axes)
        if not blocks:
            print("  WARNING: no faces for %s" % font_id)
            continue
        sections.append("/* %s */\n" % css_family + "\n\n".join(blocks))

    icon_face = "\n".join([
        "/* Material Symbols Rounded, subsetted to the %d icons VRCNext uses */" % icon_count,
        "@font-face {",
        "    font-family: 'Material Symbols Rounded';",
        "    font-style: normal;",
        "    font-weight: 100 700;",
        "    font-display: block;",
        "    src: url('files/%s') format('woff2');" % ICON_FILE,
        "}",
    ])

    header = ("/* Generated by tools/fetch-fonts.py. Do not edit by hand. */\n"
              "/* Every font here is bundled locally so VRCNext never calls fonts.googleapis.com. */\n")
    io.open(CSS_PATH, "w", encoding="utf-8", newline="\n").write(
        header + "\n" + icon_face + "\n\n" + "\n\n".join(sections) + "\n")

    size = sum(os.path.getsize(os.path.join(FILES_DIR, f)) for f in os.listdir(FILES_DIR))
    print("\nfrontend/Fonts: %d files, %.1f MB" % (len(os.listdir(FILES_DIR)), size / 1048576.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
