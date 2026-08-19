#!/usr/bin/env python3
"""Head-focused entrypoint for the BodyParts3D asset builder.

The reusable builder contains the download/export engine and vocabulary constants.
This entrypoint defines the head classifier separately so BodyParts3D structures such
as `masseter` and `temporalis` are treated as muscles even when the source label does
not literally contain the word `muscle`.
"""
from __future__ import annotations

import tools.build_bodyparts3d_assets as builder


def classify_head(name: str) -> str | None:
    text = builder.norm(name)
    if builder.contains_any(text, builder.EXCLUDE):
        return None
    if ("artery" in text or "arterial" in text) and builder.contains_any(text, builder.ARTERY_CONTEXT):
        return "artery"
    if ("vein" in text or "venous" in text or "plexus" in text or "sinus" in text) and builder.contains_any(text, builder.VEIN_CONTEXT):
        return "vein"
    if ("nerve" in text or "ganglion" in text or "optic tract" in text or "optic chiasm" in text) and builder.contains_any(text, builder.NERVE_CONTEXT):
        return "nerve"
    if builder.contains_any(text, builder.MUSCLE_CONTEXT):
        return "muscle"
    if builder.contains_any(text, builder.BONE_TERMS):
        return "bone"
    if builder.contains_any(text, builder.ORGAN_CONTEXT):
        if any(token in text for token in (" artery", " vein", " nerve", " muscle")):
            return None
        return "organ"
    return None


if __name__ == "__main__":
    builder.classify = classify_head
    raise SystemExit(builder.main())
