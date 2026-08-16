"""Assemble selected video frames into an aligned sprite-normalization source.

The video camera supplies vertical motion.  This tool preserves that global Y
coordinate while centering each character horizontally, preventing camera
drift from becoming sprite-root drift without flattening the run's natural bob.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--target-width", type=int, default=80)
    parser.add_argument("--target-height", type=int, default=110)
    parser.add_argument("--padding", type=int, default=18)
    parser.add_argument(
        "--columns",
        type=int,
        default=0,
        help="pack frames into this many columns (0 keeps a single row)",
    )
    parser.add_argument(
        "--anchor",
        choices=("center", "feet"),
        default="center",
        help="center on the whole silhouette, or lock planted feet across frames",
    )
    return parser.parse_args()


def foreground(array: np.ndarray) -> np.ndarray:
    red = array[:, :, 0].astype(np.int16)
    green = array[:, :, 1].astype(np.int16)
    blue = array[:, :, 2].astype(np.int16)
    # Gemini's backdrop is a compressed magenta gradient rather than one exact
    # key color.  Classify the hue family, then leave edge cleanup to the sheet
    # slicer's adjustable chroma tolerance.
    background = (red > 145) & (blue > 85) & (green < 105) & ((red + blue) > green * 3)
    mask = ~background
    mask[:, int(mask.shape[1] * 0.90) :] = False  # Gemini watermark region.
    mask[:3, :] = mask[-3:, :] = False
    mask[:, :3] = False

    neighbors = np.zeros(mask.shape, dtype=np.uint8)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        neighbors += np.roll(mask, (dy, dx), axis=(0, 1))
    return mask & (neighbors >= 2)


def bounds(mask: np.ndarray) -> tuple[int, int, int, int]:
    columns = np.flatnonzero(mask.sum(axis=0) > 3)
    rows = np.flatnonzero(mask.sum(axis=1) > 3)
    if not len(columns) or not len(rows):
        raise RuntimeError("Could not find the character against the magenta background")
    return int(columns[0]), int(rows[0]), int(columns[-1] + 1), int(rows[-1] + 1)


def feet_anchor(mask: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int]:
    """Return the midpoint and baseline of the subject's lowest foot region.

    Hair and swinging arms change the full silhouette's horizontal center.  An
    idle character should instead stay registered to the boots, which are the
    visual contact with the world.  The lower fifth reliably contains both
    boots while excluding most trouser motion.
    """
    left, top, right, bottom = box
    foot_top = bottom - max(1, round((bottom - top) * 0.20))
    foot_region = mask[foot_top:bottom, left:right]
    columns = np.flatnonzero(foot_region.sum(axis=0) > 2)
    if not len(columns):
        return (left + right) // 2, bottom
    foot_left = left + int(columns[0])
    foot_right = left + int(columns[-1] + 1)
    return (foot_left + foot_right) // 2, bottom


def main() -> None:
    args = arguments()
    paths = sorted(args.input.glob("*.png"))
    if not paths:
        raise RuntimeError(f"No PNG frames found in {args.input}")
    images = [Image.open(path).convert("RGB") for path in paths]
    if len({image.size for image in images}) != 1:
        raise RuntimeError("All source frames must have the same dimensions")

    arrays = [np.asarray(image) for image in images]
    masks = [foreground(array) for array in arrays]
    boxes = [bounds(mask) for mask in masks]
    anchors = [
        feet_anchor(mask, box) if args.anchor == "feet"
        else ((box[0] + box[2]) // 2, box[3])
        for mask, box in zip(masks, boxes, strict=True)
    ]
    source_width, source_height = images[0].size
    max_above_anchor = max(anchor_y - box[1] for box, (_, anchor_y) in zip(boxes, anchors, strict=True))
    frame_height = max_above_anchor + args.padding * 2
    left_extent = max(anchor_x - box[0] for box, (anchor_x, _) in zip(boxes, anchors, strict=True))
    right_extent = max(box[2] - anchor_x for box, (anchor_x, _) in zip(boxes, anchors, strict=True))
    character_width = max(left_extent, right_extent) * 2 + args.padding * 2
    aspect_width = math.ceil(frame_height * args.target_width / args.target_height)
    frame_width = max(character_width, aspect_width)
    shared_baseline = frame_height - args.padding

    key = (255, 0, 255)
    columns = args.columns if args.columns > 0 else len(images)
    columns = min(columns, len(images))
    rows = math.ceil(len(images) / columns)
    sheet = Image.new("RGB", (frame_width * columns, frame_height * rows), key)
    rects: list[dict[str, int]] = []
    for index, (image, array, box, mask, anchor) in enumerate(
        zip(images, arrays, boxes, masks, anchors, strict=True)
    ):
        clean = array.copy()
        clean[~mask] = key
        clean_image = Image.fromarray(clean, "RGB")
        anchor_x, anchor_y = anchor
        left = anchor_x - frame_width // 2
        right = left + frame_width
        top = anchor_y - shared_baseline
        bottom = top + frame_height
        source_left = max(0, left)
        source_right = min(source_width, right)
        source_top = max(0, top)
        source_bottom = min(source_height, bottom)
        column = index % columns
        row = index // columns
        destination_x = column * frame_width + max(0, -left)
        destination_y = row * frame_height + max(0, -top)
        crop = clean_image.crop((source_left, source_top, source_right, source_bottom))
        sheet.paste(crop, (destination_x, destination_y))
        rects.append(
            {
                "x": column * frame_width,
                "y": row * frame_height,
                "w": frame_width,
                "h": frame_height,
            }
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    metadata = {
        "sourceFrames": [path.name for path in paths],
        "sourceSize": [source_width, source_height],
        "frameSize": [frame_width, frame_height],
        "sheetGrid": [columns, rows],
        "targetSize": [args.target_width, args.target_height],
        "rects": rects,
        "bounds": [list(box) for box in boxes],
        "anchors": [list(anchor) for anchor in anchors],
        "alignment": (
            "feet-center; shared-foot-baseline"
            if args.anchor == "feet"
            else "silhouette-center; shared-subject-baseline"
        ),
        "keyColor": "#ff00ff",
    }
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
