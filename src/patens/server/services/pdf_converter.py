import base64
from dataclasses import asdict, dataclass
import html
import logging
import re
from typing import List, Union
import fitz  # PyMuPDF

logger = logging.getLogger("patens.services.pdf_converter")


@dataclass
class BoundingBox:
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass
class TextNode:
    id: str
    bbox: BoundingBox
    text: str


@dataclass
class FigureNode:
    id: str
    bbox: BoundingBox
    base64_png: str
    alt_text: str


@dataclass
class PageSpatialIndex:
    page_num: int
    width: float
    height: float
    text_nodes: List[TextNode]
    figure_nodes: List[FigureNode]


def _cluster_page_blocks(page: fitz.Page) -> List[dict]:
    """
    Advanced Spatial Clustering:
    Merges shattered PDF math (numerators, denominators, radicals) into unified blocks
    by detecting bridging vector drawings (fraction lines) and vertical proximity.
    """
    MATH_KEYWORDS = re.compile(
        r"(\\sum|\\int|\\frac|\\sqrt|softmax|matrix|=|\\|\+|\-|\*|\/|log|exp)",
        re.IGNORECASE
    )

    rect = page.rect
    drawings = [fitz.Rect(d["rect"]) for d in page.get_drawings() if fitz.Rect(d["rect"]).width < rect.width * 0.8]

    # 1. Extract base blocks and refine bounds using individual text spans
    text_blocks = page.get_text("blocks")
    dict_blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_LIGATURES).get("blocks", [])

    raw_blocks = []
    for i, t_b in enumerate(text_blocks):
        if t_b[6] == 0:  # Text block
            text = t_b[4].strip().replace("\n", " ")
            text = re.sub(r'\s+', ' ', text)
            if len(text) < 2:
                continue

            rect_box = fitz.Rect(t_b[:4])

            # Refine bounding box to exact span characters (fixes subscript clipping)
            if i < len(dict_blocks) and dict_blocks[i].get("type") == 0:
                x0, y0, x1, y1 = 9999, 9999, -9999, -9999
                has_spans = False
                for line in dict_blocks[i].get("lines", []):
                    for span in line.get("spans", []):
                        if span["text"].strip():
                            has_spans = True
                            sb = span["bbox"]
                            x0, y0 = min(x0, sb[0]), min(y0, sb[1])
                            x1, y1 = max(x1, sb[2]), max(y1, sb[3])
                if has_spans:
                    rect_box = fitz.Rect(x0, y0, x1, y1)

            raw_blocks.append({
                "rect": rect_box,
                "text": text,
                "is_formula": bool(MATH_KEYWORDS.search(text))
            })

    # 2. Iterative Clustering Algorithm
    blocks = raw_blocks
    changed = True
    while changed:
        changed = False
        new_blocks = []
        skip = set()

        for i in range(len(blocks)):
            if i in skip: continue

            b1 = blocks[i]
            m_rect = b1["rect"]
            m_text = b1["text"]
            m_formula = b1["is_formula"]

            for j in range(i + 1, len(blocks)):
                if j in skip: continue
                b2 = blocks[j]

                # Condition A: Blocks are connected by a shared vector drawing (e.g. Fraction line)
                shared_drawing = False
                for d_rect in drawings:
                    b1_near = (abs(m_rect.y1 - d_rect.y0) < 12 or abs(d_rect.y1 - m_rect.y0) < 12 or m_rect.intersects(
                        d_rect)) and (m_rect.x1 >= d_rect.x0 and m_rect.x0 <= d_rect.x1)
                    b2_near = (abs(b2["rect"].y1 - d_rect.y0) < 12 or abs(d_rect.y1 - b2["rect"].y0) < 12 or b2[
                        "rect"].intersects(d_rect)) and (b2["rect"].x1 >= d_rect.x0 and b2["rect"].x0 <= d_rect.x1)
                    if b1_near and b2_near:
                        shared_drawing = True
                        m_rect = m_rect | d_rect
                        break

                # Condition B: Blocks are vertically stacked with no gap (broken inline math)
                v_gap = max(0, max(m_rect.y0, b2["rect"].y0) - min(m_rect.y1, b2["rect"].y1))
                h_overlap = min(m_rect.x1, b2["rect"].x1) - max(m_rect.x0, b2["rect"].x0)
                is_close_math = v_gap < 10 and h_overlap > 0 and (m_formula or b2["is_formula"])

                if shared_drawing or is_close_math:
                    # Sort aggregated text top-to-bottom
                    if b2["rect"].y0 < m_rect.y0:
                        m_text = b2["text"] + " " + m_text
                    else:
                        m_text = m_text + " " + b2["text"]

                    m_rect = m_rect | b2["rect"]
                    m_formula = True
                    skip.add(j)
                    changed = True

            new_blocks.append({"rect": m_rect, "text": m_text, "is_formula": m_formula})

        blocks = new_blocks

    # 3. Final Sweep: Bind orphaned vector symbols (roots, brackets) to text blocks
    for b in blocks:
        for d_rect in drawings:
            near_v = abs(b["rect"].y1 - d_rect.y0) < 12 or abs(d_rect.y1 - b["rect"].y0) < 12 or b["rect"].intersects(
                d_rect)
            near_h = b["rect"].x1 >= d_rect.x0 and b["rect"].x0 <= d_rect.x1
            if near_v and near_h:
                b["rect"] = b["rect"] | d_rect
                b["is_formula"] = True

    return blocks


class FastPDFSpatialIndexer:
    """Extracts clean paragraph blocks and figure diagrams in < 1s."""

    def extract_spatial_index(self, pdf_input: Union[str, bytes]) -> List[dict]:
        doc = fitz.open(stream=pdf_input, filetype="pdf") if isinstance(pdf_input, bytes) else fitz.open(pdf_input)
        spatial_index = []

        try:
            for page_num, page in enumerate(doc, start=1):
                rect = page.rect
                text_nodes = []
                figure_nodes = []

                # Use advanced clustering logic
                clustered_blocks = _cluster_page_blocks(page)
                for b_idx, b in enumerate(clustered_blocks):
                    x0, y0, x1, y1 = b["rect"].x0, b["rect"].y0, b["rect"].x1, b["rect"].y1
                    text_nodes.append(
                        TextNode(
                            id=f"p{page_num}_t{b_idx}",
                            bbox=BoundingBox(float(x0), float(y0), float(x1), float(y1)),
                            text=b["text"]
                        )
                    )

                # Extract standalone raster figures
                for img_idx, img in enumerate(page.get_images(full=True)):
                    xref = img[0]
                    for img_rect in page.get_image_rects(xref):
                        if img_rect.width > 40 and img_rect.height > 40:
                            pix = page.get_pixmap(clip=img_rect, dpi=150)
                            img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
                            figure_nodes.append(
                                FigureNode(
                                    id=f"p{page_num}_img{img_idx}",
                                    bbox=BoundingBox(float(img_rect.x0), float(img_rect.y0), float(img_rect.x1),
                                                     float(img_rect.y1)),
                                    base64_png=f"data:image/png;base64,{img_b64}",
                                    alt_text=f"Figure on Page {page_num}",
                                )
                            )

                spatial_index.append(
                    asdict(PageSpatialIndex(page_num, float(rect.width), float(rect.height), text_nodes, figure_nodes)))
        finally:
            doc.close()

        return spatial_index


class PDFConverterService:
    """Converts a PDF into a pixel-identical HTML view with formula preservation via span clustering."""

    def convert_pdf_to_html(self, pdf_input: Union[str, bytes], document_title: str = "PDF Document") -> str:
        try:
            doc = fitz.open(stream=pdf_input, filetype="pdf") if isinstance(pdf_input, bytes) else fitz.open(pdf_input)
        except Exception as e:
            logger.error(f"Failed to open PDF document: {e}", exc_info=True)
            raise ValueError("Invalid or corrupted PDF source.") from e

        pages_html: List[str] = []

        try:
            for page_num, page in enumerate(doc, start=1):
                rect = page.rect

                # Render High-DPI Page Background Image
                pix = page.get_pixmap(dpi=150)
                bg_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")

                # Extract clustered blocks
                clustered_blocks = _cluster_page_blocks(page)
                paragraph_elements = []

                for b in clustered_blocks:
                    box = b["rect"]
                    is_formula = b["is_formula"]

                    # Formula vs Paragraph Visual Padding
                    if is_formula:
                        pad_x0 = max(0.0, box.x0 - 4.0)
                        pad_y0 = max(0.0, box.y0 - 4.0)
                        pad_x1 = min(rect.width, box.x1 + 8.0)
                        pad_y1 = min(rect.height, box.y1 + 10.0)  # Clearance for denominators
                    else:
                        pad_x0 = max(0.0, box.x0 - 2.0)
                        pad_y0 = max(0.0, box.y0 - 2.0)
                        pad_x1 = min(rect.width, box.x1 + 4.0)
                        pad_y1 = min(rect.height, box.y1 + 4.0)

                    w = pad_x1 - pad_x0
                    h = pad_y1 - pad_y0
                    escaped_text = html.escape(b["text"], quote=True)

                    # Generate high-resolution cropped equation image
                    img_attr = ""
                    if is_formula:
                        crop_rect = fitz.Rect(pad_x0, pad_y0, pad_x1, pad_y1)
                        formula_crop = page.get_pixmap(clip=crop_rect, dpi=200)
                        f_b64 = base64.b64encode(formula_crop.tobytes("png")).decode("utf-8")
                        img_attr = f'data-media-b64="data:image/png;base64,{f_b64}"'

                    paragraph_elements.append(
                        f'<div class="patens-pdf-block" '
                        f'data-clean-text="{escaped_text}" '
                        f'{img_attr} '
                        f'style="left: {pad_x0:.2f}pt; top: {pad_y0:.2f}pt; width: {w:.2f}pt; height: {h:.2f}pt;">'
                        f"</div>"
                    )

                # Extract Standalone Figure Overlays
                figure_elements = []
                for img_idx, img in enumerate(page.get_images(full=True)):
                    xref = img[0]
                    for img_rect in page.get_image_rects(xref):
                        if img_rect.width > 40 and img_rect.height > 40:
                            f_x0, f_y0 = float(img_rect.x0), float(img_rect.y0)
                            f_w, f_h = float(img_rect.width), float(img_rect.height)
                            crop_pix = page.get_pixmap(clip=img_rect, dpi=180)
                            img_b64 = base64.b64encode(crop_pix.tobytes("png")).decode("utf-8")

                            figure_elements.append(
                                f'<img class="patens-pdf-figure" '
                                f'src="data:image/png;base64,{img_b64}" '
                                f'alt="Figure {img_idx} Page {page_num}" '
                                f'style="left: {f_x0:.2f}pt; top: {f_y0:.2f}pt; width: {f_w:.2f}pt; height: {f_h:.2f}pt;" />'
                            )

                pages_html.append(f"""
                <div class="pdf-page-container" style="width: {rect.width:.2f}pt; height: {rect.height:.2f}pt;" data-page="{page_num}">
                  <img class="pdf-bg-layer" src="data:image/png;base64,{bg_b64}" alt="Page {page_num}" />
                  <div class="pdf-overlay-layer">
                    {"".join(paragraph_elements)}
                    {"".join(figure_elements)}
                  </div>
                </div>""")
        finally:
            doc.close()

        full_pages = "\n".join(pages_html)
        escaped_title = html.escape(document_title, quote=True)

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{escaped_title}</title>
  <style>
    body {{ margin: 0; padding: 30px 0; background-color: #2a2b2d; display: flex; flex-direction: column; align-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; user-select: none; }}
    #document-viewer {{ display: flex; flex-direction: column; align-items: center; width: 100%; }}
    .pdf-page-container {{ position: relative; margin-bottom: 25px; background-color: #ffffff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); border-radius: 2px; overflow: hidden; }}
    .pdf-bg-layer {{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; pointer-events: none; }}
    .pdf-overlay-layer {{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: none; }}
    .patens-pdf-block {{ position: absolute; margin: 0; padding: 0; box-sizing: border-box; background-color: transparent; cursor: pointer; pointer-events: auto; z-index: 10; border-radius: 3px; transition: background-color 0.1s ease, outline 0.1s ease; }}
    .patens-pdf-figure {{ position: absolute; margin: 0; padding: 0; box-sizing: border-box; opacity: 0; cursor: pointer; pointer-events: auto; z-index: 20; transition: opacity 0.15s ease, outline 0.15s ease; }}
    .patens-pdf-block:hover, .patens-pdf-block.cc-highlight-hover {{ background-color: rgba(59, 130, 246, 0.22) !important; outline: 2px solid #2563eb !important; }}
    .patens-pdf-figure:hover, .patens-pdf-figure.cc-highlight-hover {{ opacity: 1.0 !important; outline: 3px solid #10b981 !important; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }}
  </style>
</head>
<body>
  <div id="document-viewer">
    {full_pages}
  </div>
</body>
</html>"""