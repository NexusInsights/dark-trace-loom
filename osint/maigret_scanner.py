"""
Dark Trace Loom - Maigret Integration
Wraps soxoj/maigret (3000+ sites) for programmatic username scanning.
Profile page parsing, ID extraction, recursive identity discovery.
No reimplementation. Direct library calls.
"""
import asyncio
import logging
import os
import json
from datetime import datetime, timezone
from typing import Optional

import maigret as maigret_lib
from maigret import MaigretDatabase, search
from maigret.result import MaigretCheckStatus
from maigret.maigret import extract_ids_from_results


# Suppress maigret's own logging noise in our context
_logger = logging.getLogger("maigret-dtl")
_logger.setLevel(logging.WARNING)


def _load_db() -> MaigretDatabase:
    """Load maigret's bundled site database."""
    db_path = os.path.join(maigret_lib.__path__[0], "resources", "data.json")
    return MaigretDatabase().load_from_path(db_path)


async def scan_username(
    username: str,
    top: int = 500,
    tags: list = None,
    timeout: int = 8,
    max_connections: int = 50,
    parse_profiles: bool = True,
    all_sites: bool = False,
) -> dict:
    """
    Scan a username using maigret's full engine.

    Args:
        username: Target username
        top: Number of top-ranked sites to check (default 500, use 0 or all_sites=True for all)
        tags: Filter by tags (e.g. ["us", "photo", "dating"])
        timeout: Per-site timeout in seconds
        max_connections: Concurrent connection limit
        parse_profiles: Enable profile page parsing for identity extraction
        all_sites: Check all 3000+ sites (overrides top)

    Returns:
        Dict with found profiles, extracted IDs, stats
    """
    db = _load_db()

    # Build site dict
    site_count = 99999 if all_sites else top
    sites = db.ranked_sites_dict(
        top=site_count,
        tags=tags or [],
        id_type="username",
    )

    # Run the scan
    results = await search(
        username=username,
        site_dict=sites,
        logger=_logger,
        timeout=timeout,
        max_connections=max_connections,
        is_parsing_enabled=parse_profiles,
        no_progressbar=True,
        id_type="username",
    )

    # Process results
    found = []
    not_found = []
    errors = []

    for site_name, result_obj in results.items():
        entry = result_obj.json()

        if result_obj.status == MaigretCheckStatus.CLAIMED:
            found.append(entry)
        elif result_obj.status == MaigretCheckStatus.AVAILABLE:
            not_found.append(entry)
        else:
            errors.append(entry)

    # Extract discovered IDs from found profiles (maigret's killer feature)
    extracted_ids = {}
    if parse_profiles:
        try:
            extracted_ids = extract_ids_from_results(results, db)
        except Exception:
            pass

    # Organize found by tags
    found_by_tag = {}
    for f in found:
        for tag in f.get("tags", ["untagged"]):
            if tag not in found_by_tag:
                found_by_tag[tag] = []
            found_by_tag[tag].append(f)

    return {
        "username": username,
        "total_checked": len(results),
        "found_count": len(found),
        "not_found_count": len(not_found),
        "error_count": len(errors),
        "found": found,
        "not_found_count_only": len(not_found),  # Don't dump 2500 not-found entries
        "errors": errors[:20],  # Cap error output
        "found_by_tag": found_by_tag,
        "extracted_ids": extracted_ids,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "engine": "maigret",
        "db_sites_total": len(sites),
    }


async def get_db_stats() -> dict:
    """Return maigret database statistics."""
    db = _load_db()
    all_sites = db.ranked_sites_dict(top=99999, id_type="username")
    default_sites = db.ranked_sites_dict(top=500, id_type="username")

    # Count tags
    tags = {}
    for name, site in all_sites.items():
        for tag in site.tags:
            tags[tag] = tags.get(tag, 0) + 1

    return {
        "total_sites": len(all_sites),
        "default_scan_sites": len(default_sites),
        "tags": dict(sorted(tags.items(), key=lambda x: -x[1])),
        "engine": "maigret",
        "version": getattr(maigret_lib, "__version__", "unknown"),
    }
