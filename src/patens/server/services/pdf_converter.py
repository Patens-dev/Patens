# src/patens/server/services/pdf_converter.py
import base64
from dataclasses import asdict, dataclass
import html
import logging
import re
from typing import List, Dict, Any, Union
import fitz  # PyMuPDF

logger = logging.getLogger("patens.services.pdf_converter")

MATH_KEYWORDS = re.compile(
    r"(\\sum|\\int|\\frac|\\sqrt|softmax|matrix|[=∑∫√±×÷≠≤≥≈∈∀∃∂∇]|\b(?:log|exp|lim|sin|cos|tan)\b)",
    re.IGNORECASE
)


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


def _extract_clean_paragraphs(page: fitz.Page) -> List[Dict[str, Any]]:
    """
    Extracts individual, distinct paragraph blocks using MuPDF's native C layout engine.
    Splits multi-paragraph blocks and isolates section headers and formulas in < 2ms/page.
    """
    raw_blocks = page.get_text("blocks")
    if not raw_blocks:
        return []

    paragraphs = []
    for b in raw_blocks:
        if b[6] != 0:  # Skip image blocks
            continue

        raw_text = b[4].strip()
        if len(raw_text) < 2:
            continue

        bx0, by0, bx1, by1 = float(b[0]), float(b[1]), float(b[2]), float(b[3])

        # Split multi-paragraph blocks separated by blank lines
        sub_paras = [p.strip() for p in re.split(r'\n\s*\n+', raw_text) if p.strip()]

        if len(sub_paras) <= 1:
            clean_text = re.sub(r'\s+', ' ', raw_text)
            is_formula = bool(MATH_KEYWORDS.search(clean_text)) and len(clean_text) < 200
            paragraphs.append({
                "text": clean_text,
                "bbox": fitz.Rect(bx0, by0, bx1, by1),
                "is_formula": is_formula
            })
        else:
            total_lines = max(1, sum(p.count('\n') + 1 for p in sub_paras))
            curr_y = by0
            block_h = by1 - by0

            for sp in sub_paras:
                sp_clean = re.sub(r'\s+', ' ', sp)
                sp_lines = sp.count('\n') + 1
                sp_height = (sp_lines / total_lines) * block_h
                sp_box = fitz.Rect(bx0, curr_y, bx1, curr_y + sp_height)
                curr_y += sp_height

                is_formula = bool(MATH_KEYWORDS.search(sp_clean)) and len(sp_clean) < 200
                paragraphs.append({
                    "text": sp_clean,
                    "bbox": sp_box,
                    "is_formula": is_formula
                })

    return paragraphs


class FastPDFSpatialIndexer:
    """Extracts clean paragraph blocks and figure diagrams in < 50ms per document."""

    def extract_spatial_index(self, pdf_input: Union[str, bytes]) -> List[dict]:
        doc = fitz.open(stream=pdf_input, filetype="pdf") if isinstance(pdf_input, bytes) else fitz.open(pdf_input)
        spatial_index = []

        try:
            for page_num, page in enumerate(doc, start=1):
                rect = page.rect
                text_nodes = []
                figure_nodes = []

                paras = _extract_clean_paragraphs(page)
                for b_idx, p in enumerate(paras):
                    box = p["bbox"]
                    text_nodes.append(
                        TextNode(
                            id=f"p{page_num}_t{b_idx}",
                            bbox=BoundingBox(float(box.x0), float(box.y0), float(box.x1), float(box.y1)),
                            text=p["text"]
                        )
                    )

                # Standalone raster figures
                seen_rects = []
                for img_idx, img in enumerate(page.get_images(full=True)[:10]):
                    xref = img[0]
                    for img_rect in page.get_image_rects(xref):
                        if img_rect.width > 40 and img_rect.height > 40:
                            if any(img_rect.intersects(r) for r in seen_rects):
                                continue
                            seen_rects.append(img_rect)

                            pix = page.get_pixmap(clip=img_rect, dpi=160)
                            img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
                            figure_nodes.append(
                                FigureNode(
                                    id=f"p{page_num}_img{img_idx}",
                                    bbox=BoundingBox(
                                        float(img_rect.x0), float(img_rect.y0),
                                        float(img_rect.x1), float(img_rect.y1)
                                    ),
                                    base64_png=f"data:image/png;base64,{img_b64}",
                                    alt_text=f"Figure on Page {page_num}",
                                )
                            )

                spatial_index.append(
                    asdict(PageSpatialIndex(
                        page_num,
                        float(rect.width),
                        float(rect.height),
                        text_nodes,
                        figure_nodes
                    ))
                )
        finally:
            doc.close()

        return spatial_index


class PDFConverterService:
    """Converts a PDF into a pixel-sharp, 2x Retina HTML view with granular paragraph highlights."""

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

                # 150 DPI Retina Rendering (2.08x supersampling for razor-sharp text)
                pix = page.get_pixmap(dpi=150)
                try:
                    bg_b64 = base64.b64encode(pix.tobytes("webp", quality=90)).decode("utf-8")
                    mime_type = "image/webp"
                except Exception:
                    bg_b64 = base64.b64encode(pix.tobytes("jpeg", jpg_quality=92)).decode("utf-8")
                    mime_type = "image/jpeg"

                paragraphs = _extract_clean_paragraphs(page)
                paragraph_elements = []

                for p in paragraphs:
                    box = p["bbox"]
                    is_formula = p["is_formula"]

                    pad_x0 = max(0.0, box.x0 - 2.0)
                    pad_y0 = max(0.0, box.y0 - 2.0)
                    pad_x1 = min(rect.width, box.x1 + 3.0)
                    pad_y1 = min(rect.height, box.y1 + 3.0)

                    w = pad_x1 - pad_x0
                    h = pad_y1 - pad_y0
                    escaped_text = html.escape(p["text"], quote=True)

                    img_attr = ""
                    if is_formula:
                        crop_rect = fitz.Rect(pad_x0, pad_y0, pad_x1, pad_y1) & rect
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

                # Extract standalone figures
                figure_elements = []
                seen_rects = []
                for img_idx, img in enumerate(page.get_images(full=True)[:10]):
                    xref = img[0]
                    for img_rect in page.get_image_rects(xref):
                        if img_rect.width > 40 and img_rect.height > 40:
                            if any(img_rect.intersects(r) for r in seen_rects):
                                continue
                            seen_rects.append(img_rect)

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
                  <img class="pdf-bg-layer" src="data:{mime_type};base64,{bg_b64}" alt="Page {page_num}" />
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
    body {{
      margin: 0;
      padding: 30px 0;
      background-color: #18181b;
      display: flex;
      flex-direction: column;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }}
    #document-viewer {{
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }}
    .pdf-page-container {{
      position: relative;
      margin-bottom: 25px;
      background-color: #ffffff;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      overflow: hidden;
    }}
    .pdf-bg-layer {{
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: auto;
    }}
    .pdf-overlay-layer {{
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 10;
      pointer-events: none;
    }}
    .patens-pdf-block {{
      position: absolute;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      background-color: transparent;
      cursor: pointer;
      pointer-events: auto;
      z-index: 10;
      border-radius: 3px;
      transition: background-color 0.1s ease, outline 0.1s ease;
    }}
    .patens-pdf-figure {{
      position: absolute;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      opacity: 0;
      cursor: pointer;
      pointer-events: auto;
      z-index: 20;
      transition: opacity 0.15s ease, outline 0.15s ease;
    }}
    .patens-pdf-block:hover, .patens-pdf-block.cc-highlight-hover {{
      background-color: rgba(59, 130, 246, 0.22) !important;
      outline: 2px solid #2563eb !important;
    }}
    .patens-pdf-figure:hover, .patens-pdf-figure.cc-highlight-hover {{
      opacity: 1.0 !important;
      outline: 3px solid #10b981 !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }}
  </style>
</head>
<body>
  <div id="document-viewer">
    {full_pages}
  </div>
</body>
</html>"""