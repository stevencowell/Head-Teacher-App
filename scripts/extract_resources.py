"""Extract resources from the Head Teacher information DOCX file.

This script parses the Word document that underpins the Head Teacher
information pack and produces a structured JSON file used by the front-end
landing page.  It can be rerun whenever the document is updated.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Dict, List
import xml.etree.ElementTree as ET

DOCX_NAME = "Head Teacher Information For TAS Faculty - Wagga Wagga High School (1) (1).docx"
OUTPUT_PATH = Path("data/resources.json")

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

PLACEHOLDER_LABELS = {
    label.lower()
    for label in [
        "here",
        "here.",
        "click here",
        "click here.",
        "link",
        "the link",
        "this link",
        "this link.",
        "here..",
        "available here",
        "available here.",
    ]
}

TRAILING_PHRASES = [
    "can be found",
    "can be accessed",
    "can be viewed",
    "can be downloaded",
    "can be located",
    "can be obtained",
    "is located",
    "is stored",
    "are stored",
    "are located",
    "are found",
    "are available",
    "can be found on",
    "can be found in",
    "can be found at",
    "can be accessed via",
    "can be accessed at",
    "can be found via",
    "can be viewed on",
    "can be viewed in",
    "can be downloaded from",
    "can be accessed from",
    "can be accessed through",
    "can be accessed online",
    "can be located here",
    "can be seen",
    "is available",
    "are available to",
    "are available for",
    "are available from",
    "is available from",
    "is available on",
    "is available at",
    "are available on",
    "is accessible",
    "are accessible",
    "can be used",
    "can be found here",
    "can be located here",
    "link can be found",
    "link is here",
    "link is available",
    "links can be found",
    "links can be accessed",
    "can be found using",
    "be found",
    "be accessed",
    "found here",
    "found on",
    "found in",
    "found at",
    "found via",
    "available here",
    "available on",
    "available at",
    "available in",
    "available via",
    "to access",
    "to be found",
    "located here",
    "located on",
    "located at",
    "located in",
    "can be downloaded via",
    "can be downloaded at",
    "can be accessed here",
    "is stored on",
    "are stored on",
    "are stored in",
    "can be downloaded",
    "can be viewed here",
]

STOP_PREFIXES = ["A ", "The ", "This ", "These ", "An ", "For ", "To "]
LEAD_PHRASES = ["and ", "or ", "for ", "to ", "via "]


def _clean_label(candidate: str | None) -> str | None:
    if not candidate:
        return None

    text = candidate.strip()
    if not text:
        return None

    changed = True
    while changed and text:
        changed = False
        lowered = text.lower()
        for phrase in TRAILING_PHRASES:
            if lowered.endswith(phrase):
                text = text[: -len(phrase)].rstrip(" -:\u2013\u2014,.;()[]{}")
                changed = True
                break

    text = text.strip(" -:\u2013\u2014,.;()[]{}")
    for prefix in STOP_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix) :]

    trimmed = True
    while trimmed and text:
        trimmed = False
        for phrase in LEAD_PHRASES:
            if text.lower().startswith(phrase):
                text = text[len(phrase) :]
                trimmed = True
                break

    return text.strip(" -:\u2013\u2014,.;()[]{}") or None


def _parse_runs(element: ET.Element, rels: Dict[str, str]) -> List[Dict[str, str]]:
    result = []
    plain = ""

    for child in list(element):
        if child.tag == f"{{{NS['w']}}}hyperlink":
            rid = child.attrib.get(f"{{{NS['r']}}}id")
            url = rels.get(rid)
            label = "".join(t.text for t in child.findall('.//w:t', NS) if t.text)
            result.append({"type": "link", "raw_label": label, "url": url, "before": plain})
            plain += label or ""
        else:
            texts = [t.text for t in child.findall('.//w:t', NS) if t.text]
            if texts:
                text = "".join(texts)
                result.append({"type": "text", "text": text})
                plain += text

    full = "".join(part.get("text", part.get("raw_label", "")) for part in result)
    for part in result:
        if part.get("type") == "link":
            label = part.get("raw_label") or ""
            start = len(part["before"])
            part["after"] = full[start + len(label) :]

    return result


def _parse_cell(tc: ET.Element, rels: Dict[str, str]) -> Dict[str, object]:
    paragraphs: List[str] = []
    links: List[Dict[str, str]] = []

    for paragraph in tc.findall('.//w:p', NS):
        runs = _parse_runs(paragraph, rels)
        paragraph_text = "".join(part.get("text", part.get("raw_label", "")) for part in runs).strip()
        if paragraph_text:
            paragraphs.append(paragraph_text)

        for part in runs:
            if part.get("type") != "link" or not part.get("url"):
                continue

            raw_label = (part.get("raw_label") or "").strip()
            if not raw_label or raw_label.lower() in PLACEHOLDER_LABELS:
                before = part.get("before", "")
                candidate_segment = before
                candidate = re.split(r"[\.;!?\n]", candidate_segment)[-1]
                label_candidate = _clean_label(candidate)
                if not label_candidate:
                    label_candidate = _clean_label(before[-160:])
                label = label_candidate or "Resource link"
            else:
                label = raw_label.strip()

            links.append({"label": label, "url": part["url"]})

    return {"text": "\n".join(paragraphs).strip(), "links": links}


def extract() -> List[Dict[str, object]]:
    docx_path = Path(DOCX_NAME)
    if not docx_path.exists():
        raise FileNotFoundError(f"Unable to locate {DOCX_NAME}")

    with zipfile.ZipFile(docx_path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        rels_root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))

    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root}
    body = document.find("w:body", NS)
    if body is None:
        raise RuntimeError("Document body not found")

    table = body.find("w:tbl", NS)
    if table is None:
        raise RuntimeError("Expected resource table was not found in the document")

    rows = table.findall("w:tr", NS)
    if not rows:
        raise RuntimeError("The resource table does not contain any rows")

    categories: List[Dict[str, object]] = []
    current_category: Dict[str, object] | None = None

    category_pattern = re.compile(r"^([A-Z])\.\s*(.+)")
    section_pattern = re.compile(r"^([A-Z])(\d+)\.\s*(.+)")

    for row in rows[1:]:  # Skip the header row
        cells = row.findall("w:tc", NS)
        cell_parsed = [_parse_cell(cell, rel_map) for cell in cells]
        first_text = cell_parsed[0]["text"] if cell_parsed else ""
        if not first_text:
            continue

        cat_match = category_pattern.match(first_text)
        sec_match = section_pattern.match(first_text)

        if cat_match and not sec_match:
            description = cell_parsed[1]["text"] if len(cell_parsed) > 1 else ""
            links = cell_parsed[1]["links"] if len(cell_parsed) > 1 else []
            current_category = {
                "code": cat_match.group(1),
                "title": cat_match.group(2).strip(),
                "description": description,
                "links": links,
                "sections": [],
            }
            categories.append(current_category)
            continue

        if sec_match:
            if current_category is None or current_category.get("code") != sec_match.group(1):
                current_category = {
                    "code": sec_match.group(1),
                    "title": "Misc",
                    "description": "",
                    "links": [],
                    "sections": [],
                }
                categories.append(current_category)

            status = cell_parsed[1]["text"] if len(cell_parsed) > 1 else ""
            description = (
                cell_parsed[2]["text"]
                if len(cell_parsed) > 2
                else (cell_parsed[1]["text"] if len(cell_parsed) > 1 else "")
            )

            links: List[Dict[str, str]] = []
            if len(cell_parsed) > 2:
                links.extend(cell_parsed[2]["links"])
            if len(cell_parsed) > 1:
                links.extend(cell_parsed[1]["links"])

            section = {
                "code": f"{sec_match.group(1)}{sec_match.group(2)}",
                "title": sec_match.group(3).strip(),
                "status": status,
                "description": description,
                "links": links,
            }
            current_category.setdefault("sections", []).append(section)
            continue

        if current_category and current_category.get("sections"):
            section = current_category["sections"][-1]
            extra_text = " ".join(
                filter(
                    None,
                    [
                        section.get("description", ""),
                        " ".join(filter(None, [cell.get("text") for cell in cell_parsed[1:]])),
                    ],
                )
            )
            section["description"] = extra_text.strip()
            for cell in cell_parsed[1:]:
                section.setdefault("links", []).extend(cell.get("links", []))

    return categories


def main(argv: List[str]) -> int:
    categories = extract()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(categories, indent=2, ensure_ascii=False))
    print(f"Wrote {len(categories)} categories to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
