"""Make the atlas basemap (web/public/atlas/basemap.json) from Natural Earth 1:10m shapefiles (public domain).

The atlas draws its own map instead of loading tiles from a third-party server: land, lakes, coastlines and
rivers, clipped to the Mediterranean and the Near East and simplified (more detail around the Levant, less
at the edges). Shapefiles are read with the standard library only.

    py -m testimonia fetch natural-earth
    py -I tools/build_basemap.py <raw dir>/natural-earth web/public/atlas/basemap.json

Run it isolated (-I): it reads downloaded files.
"""

from __future__ import annotations

import json
import struct
import sys
from collections.abc import Callable, Iterator
from pathlib import Path

Point = tuple[float, float]
Ring = list[Point]

BBOX = (-11.0, 10.0, 64.0, 49.0)  # west, south, east, north: Spain to Persia, Arabia to the Black Sea
CORE = (33.0, 28.5, 38.0, 35.0)  # the Levant: kept most detailed
MIDDLE = (19.0, 24.0, 50.0, 42.0)  # Greece, Asia Minor, Egypt, Mesopotamia
SEAS = [  # label points (lon, lat) chosen by hand
    ("Mediterranean Sea", 18.5, 34.2),
    ("Aegean Sea", 25.0, 38.9),
    ("Adriatic Sea", 15.6, 42.9),
    ("Black Sea", 34.5, 43.3),
    ("Red Sea", 38.4, 20.6),
    ("Persian Gulf", 51.0, 27.4),
    ("Caspian Sea", 51.0, 41.2),
    ("Arabian Sea", 61.0, 15.0),
    ("Atlantic Ocean", -9.5, 33.0),
]


def inside(box: tuple[float, float, float, float], x: float, y: float) -> bool:
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def tolerance(x: float, y: float) -> float:
    """Simplification tolerance in degrees: ~300 m in the Levant, ~1 km around it, ~3 km at the edges."""
    if inside(CORE, x, y):
        return 0.003
    if inside(MIDDLE, x, y):
        return 0.01
    return 0.03


# ----------------------------------------------------------------------------- shapefile reading


def read_dbf(path: Path) -> list[dict[str, str]]:
    data = path.read_bytes()
    n, header, size = struct.unpack("<IHH", data[4:12])
    fields: list[tuple[str, int]] = []
    off = 32
    while data[off] != 0x0D:
        name = data[off : off + 11].split(b"\0", 1)[0].decode("ascii", "replace").lower()
        fields.append((name, data[off + 16]))
        off += 32
    rows = []
    for i in range(n):
        rec = data[header + i * size : header + (i + 1) * size]
        pos, row = 1, {}
        for name, length in fields:
            row[name] = rec[pos : pos + length].split(bytes(1), 1)[0].decode("utf-8", "replace").strip()
            pos += length
        rows.append(row)
    return rows


def read_shp(path: Path) -> Iterator[list[Ring]]:
    """Parts of each PolyLine (3) / Polygon (5) record, in record order."""
    data = path.read_bytes()
    if struct.unpack(">i", data[:4])[0] != 9994:
        raise ValueError(f"{path.name}: not a shapefile")
    off = 100
    while off + 8 <= len(data):
        length = struct.unpack(">i", data[off + 4 : off + 8])[0] * 2
        rec = data[off + 8 : off + 8 + length]
        off += 8 + length
        kind = struct.unpack("<i", rec[:4])[0]
        if kind == 0:
            yield []
            continue
        if kind not in (3, 5):
            raise ValueError(f"{path.name}: unsupported shape type {kind}")
        nparts, npoints = struct.unpack("<ii", rec[36:44])
        parts = [*(struct.unpack(f"<{nparts}i", rec[44 : 44 + 4 * nparts])), npoints]
        base = 44 + 4 * nparts
        coords = struct.unpack(f"<{2 * npoints}d", rec[base : base + 16 * npoints])
        pts = [(coords[2 * i], coords[2 * i + 1]) for i in range(npoints)]
        yield [pts[parts[i] : parts[i + 1]] for i in range(nparts)]


# ----------------------------------------------------------------------------- geometry


def clip_ring(ring: Ring, box: tuple[float, float, float, float]) -> Ring:
    """Sutherland–Hodgman clipping of a closed ring to a rectangle."""
    west, south, east, north = box
    edges: list[tuple[Callable[[Point], bool], Callable[[Point, Point], Point]]] = [
        (lambda p: p[0] >= west, lambda a, b: (west, a[1] + (b[1] - a[1]) * (west - a[0]) / (b[0] - a[0]))),
        (lambda p: p[0] <= east, lambda a, b: (east, a[1] + (b[1] - a[1]) * (east - a[0]) / (b[0] - a[0]))),
        (lambda p: p[1] >= south, lambda a, b: (a[0] + (b[0] - a[0]) * (south - a[1]) / (b[1] - a[1]), south)),
        (lambda p: p[1] <= north, lambda a, b: (a[0] + (b[0] - a[0]) * (north - a[1]) / (b[1] - a[1]), north)),
    ]
    out = ring
    for keep, cross in edges:
        if not out:
            break
        src, out = out, []
        prev = src[-1]
        for cur in src:
            if keep(cur):
                if not keep(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif keep(prev):
                out.append(cross(prev, cur))
            prev = cur
    return out


def clip_line(line: Ring, box: tuple[float, float, float, float]) -> list[Ring]:
    """Pieces of a line inside the box (each keeps one point beyond the edge, hidden by the map bounds)."""
    pieces: list[Ring] = []
    cur: Ring = []
    for i, p in enumerate(line):
        if inside(box, *p):
            if not cur and i > 0:
                cur.append(line[i - 1])
            cur.append(p)
        elif cur:
            cur.append(p)
            pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    return [p for p in pieces if len(p) > 1]


def _dist(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == dy == 0:
        return ((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return ((p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2) ** 0.5


def simplify(pts: Ring) -> Ring:
    """Douglas–Peucker with a tolerance that depends on where the points are."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            d = _dist(pts[k], pts[i], pts[j])
            if d > best:
                best, idx = d, k
        if idx >= 0 and best > tolerance(*pts[idx]):
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep, strict=True) if k]


def simplify_ring(ring: Ring) -> Ring:
    if len(ring) < 4:
        return []
    far = max(range(len(ring)), key=lambda k: (ring[k][0] - ring[0][0]) ** 2 + (ring[k][1] - ring[0][1]) ** 2)
    out = simplify(ring[: far + 1])[:-1] + simplify([*ring[far:], ring[0]])[:-1]
    return [*out, out[0]] if len(out) >= 3 else []


def area(ring: Ring) -> float:
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1], strict=True))) / 2


def min_area(ring: Ring) -> float:
    x, y = ring[0]
    return 0.00002 if inside(CORE, x, y) else 0.0004 if inside(MIDDLE, x, y) else 0.004


def rnd(pts: Ring) -> list[list[float]]:
    out: list[list[float]] = []
    for x, y in pts:
        q = [round(x, 3), round(y, 3)]
        if not out or out[-1] != q:
            out.append(q)
    return out


def polygons(shp: Path) -> list[list[list[float]]]:
    rings = []
    for parts in read_shp(shp):
        for ring in parts:
            if not any(inside(BBOX, *p) for p in ring) and not _encloses(ring):
                continue
            clipped = clip_ring(ring, BBOX)
            if len(clipped) < 3 or area(clipped) < min_area(clipped):
                continue
            simple = simplify_ring(clipped if clipped[0] == clipped[-1] else [*clipped, clipped[0]])
            if len(simple) >= 4:
                rings.append(rnd(simple))
    return rings


def _encloses(ring: Ring) -> bool:
    """A ring with no vertex in the box may still cover it (it never does for these layers, but be safe)."""
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    return min(xs) < BBOX[0] and max(xs) > BBOX[2] and min(ys) < BBOX[1] and max(ys) > BBOX[3]


def lines(
    shp: Path, rows: list[dict[str, str]] | None = None
) -> Iterator[tuple[dict[str, str], list[list[list[float]]]]]:
    for i, parts in enumerate(read_shp(shp)):
        out = []
        for part in parts:
            for piece in clip_line(part, BBOX):
                simple = rnd(simplify(piece))
                if len(simple) > 1:
                    out.append(simple)
        if out:
            yield (rows[i] if rows else {}), out


def main(raw: Path, dest: Path) -> None:
    shp = {p.stem: p for p in raw.rglob("*.shp")}
    features: list[dict[str, object]] = []
    land = polygons(shp["ne_10m_land"])
    features.append(
        {"type": "Feature", "properties": {"k": "land"}, "geometry": {"type": "Polygon", "coordinates": land}}
    )
    lake_rows = read_dbf(shp["ne_10m_lakes"].with_suffix(".dbf"))
    lakes = []
    for row, parts in zip(lake_rows, read_shp(shp["ne_10m_lakes"]), strict=True):
        for ring in parts:
            if any(inside(BBOX, *p) for p in ring) and area(ring) >= min_area(ring) * 2:
                simple = simplify_ring(ring)
                if len(simple) >= 4:
                    lakes.append(rnd(simple))
        del row
    features.append(
        {"type": "Feature", "properties": {"k": "lake"}, "geometry": {"type": "Polygon", "coordinates": lakes}}
    )
    coast = [part for _, parts in lines(shp["ne_10m_coastline"]) for part in parts]
    features.append(
        {"type": "Feature", "properties": {"k": "coast"}, "geometry": {"type": "MultiLineString", "coordinates": coast}}
    )
    river_rows = read_dbf(shp["ne_10m_rivers_lake_centerlines"].with_suffix(".dbf"))
    for row, parts in lines(shp["ne_10m_rivers_lake_centerlines"], river_rows):
        rank = int(float(row.get("scalerank") or 9))
        if row.get("featurecla", "").lower().startswith("lake"):
            continue
        if rank > 6 and not any(inside(MIDDLE, x, y) for part in parts for x, y in part):
            continue  # far from the biblical world only the great rivers are drawn
        props = {"k": "river", "n": row.get("name_en") or row.get("name", ""), "r": rank}
        features.append(
            {"type": "Feature", "properties": props, "geometry": {"type": "MultiLineString", "coordinates": parts}}
        )
    for name, x, y in SEAS:
        features.append(
            {
                "type": "Feature",
                "properties": {"k": "sea", "n": name},
                "geometry": {"type": "Point", "coordinates": [x, y]},
            }
        )
    out = {
        "type": "FeatureCollection",
        "bbox": list(BBOX),
        "attribution": "Made with Natural Earth (public domain), 1:10m physical layers, simplified for Testimonia",
        "features": features,
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(
        f"{dest}: {dest.stat().st_size / 1024:.0f} KB, {len(features)} features, "
        f"{len(land)} land rings, {len(lakes)} lakes"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
