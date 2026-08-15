# tests/test_pdf_converter.py
import base64
from dataclasses import asdict
import html
import io
from pathlib import Path
import pytest
import fitz

from patens.server.services.pdf_converter import (
    BoundingBox,
    TextNode,
    FigureNode,
    PageSpatialIndex,
    _extract_clean_paragraphs,
    FastPDFSpatialIndexer,
    PDFConverterService,
)


# =====================================================================
# HELPER FIXTURES: PROGRAMMATIC PDF GENERATION
# =====================================================================

@pytest.fixture
def create_pdf_bytes():
    """Helper factory to programmatically create in-memory PDF byte streams."""

    def _generator(pages_data=None):
        doc = fitz.open()

        if not pages_data:
            # Default single page with text
            page = doc.new_page(width=595, height=842)
            page.insert_text((50, 50), "Hello World Paragraph")
        else:
            for p_data in pages_data:
                page = doc.new_page(width=p_data.get("width", 595), height=p_data.get("height", 842))

                # Insert Text
                for text_item in p_data.get("texts", []):
                    pos = text_item.get("pos", (50, 50))
                    text = text_item.get("text", "Sample Text")
                    fontsize = text_item.get("fontsize", 12)
                    page.insert_text(pos, text, fontsize=fontsize)

                # Insert Drawings / Lines (e.g. fraction line)
                for line in p_data.get("lines", []):
                    shape = page.new_shape()
                    shape.draw_line(line[0], line[1])
                    shape.finish(color=(0, 0, 0), width=1)
                    shape.commit()

                # Insert Images
                for img_spec in p_data.get("images", []):
                    rect = fitz.Rect(img_spec.get("rect", (100, 100, 200, 200)))
                    w, h = int(rect.width), int(rect.height)
                    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h), False)
                    pix.clear_with(0xFF0000)  # Red background
                    page.insert_image(rect, pixmap=pix)

        pdf_bytes = doc.tobytes()
        doc.close()
        return pdf_bytes

    return _generator


@pytest.fixture
def sample_pdf_path(tmp_path, create_pdf_bytes):
    """Writes sample PDF bytes to a temporary file path."""
    pdf_bytes = create_pdf_bytes()
    file_path = tmp_path / "sample.pdf"
    file_path.write_bytes(pdf_bytes)
    return str(file_path)


# =====================================================================
# 1. DATACLASS UNIT TESTS
# =====================================================================

def test_bounding_box_and_node_dataclasses():
    """Tests instantiation and dictionary serialization of spatial index dataclasses."""
    bbox = BoundingBox(x0=10.0, y0=20.0, x1=100.0, y1=200.0)
    text_node = TextNode(id="p1_t0", bbox=bbox, text="Sample Text")
    fig_node = FigureNode(id="p1_img0", bbox=bbox, base64_png="data:image/png;base64,xyz", alt_text="Figure 1")

    page_index = PageSpatialIndex(
        page_num=1,
        width=595.0,
        height=842.0,
        text_nodes=[text_node],
        figure_nodes=[fig_node]
    )

    data = asdict(page_index)

    assert data["page_num"] == 1
    assert data["width"] == 595.0
    assert data["text_nodes"][0]["id"] == "p1_t0"
    assert data["text_nodes"][0]["bbox"]["x0"] == 10.0
    assert data["figure_nodes"][0]["alt_text"] == "Figure 1"


# =====================================================================
# 2. UNIT TESTS: _extract_clean_paragraphs
# =====================================================================

def test_extract_clean_paragraphs_basic_text(create_pdf_bytes):
    """Tests paragraph extraction for simple plain text paragraphs without formulas."""
    pdf_bytes = create_pdf_bytes([
        {"texts": [{"pos": (50, 50), "text": "First line of paragraph."}]}
    ])
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]

    blocks = _extract_clean_paragraphs(page)
    doc.close()

    assert len(blocks) == 1
    assert "First line of paragraph." in blocks[0]["text"]
    assert blocks[0]["is_formula"] is False


def test_extract_clean_paragraphs_formula_keyword_detection(create_pdf_bytes):
    """Tests that math keywords trigger is_formula flag on blocks."""
    pdf_bytes = create_pdf_bytes([
        {"texts": [{"pos": (50, 50), "text": "E = mc^2 where \\sum x = 10"}]}
    ])
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]

    blocks = _extract_clean_paragraphs(page)
    doc.close()

    assert len(blocks) == 1
    assert blocks[0]["is_formula"] is True


def test_extract_clean_paragraphs_filters_short_garbage(create_pdf_bytes):
    """Tests filtering out isolated single-character blocks (< 2 chars)."""
    pdf_bytes = create_pdf_bytes([
        {"texts": [{"pos": (50, 50), "text": "a"}]}
    ])
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]

    blocks = _extract_clean_paragraphs(page)
    doc.close()

    assert len(blocks) == 0


def test_extract_clean_paragraphs_splits_multi_paragraph(create_pdf_bytes):
    """Tests splitting blocks containing distinct paragraphs separated by blank lines."""
    pdf_bytes = create_pdf_bytes([
        {
            "texts": [
                {"pos": (50, 50), "text": "First distinct paragraph.\n\nSecond distinct paragraph."}
            ]
        }
    ])
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]

    blocks = _extract_clean_paragraphs(page)
    doc.close()

    assert len(blocks) == 2
    assert "First distinct paragraph." in blocks[0]["text"]
    assert "Second distinct paragraph." in blocks[1]["text"]


# =====================================================================
# 3. UNIT TESTS: FastPDFSpatialIndexer
# =====================================================================

def test_spatial_indexer_extracts_text_and_figures_from_bytes(create_pdf_bytes):
    """Tests spatial index extraction from PDF byte stream."""
    pdf_bytes = create_pdf_bytes([
        {
            "texts": [{"pos": (50, 50), "text": "Sample Document Paragraph"}],
            "images": [{"rect": (100, 100, 200, 200)}]  # 100x100 > 40x40 threshold
        }
    ])

    indexer = FastPDFSpatialIndexer()
    index_data = indexer.extract_spatial_index(pdf_bytes)

    assert len(index_data) == 1
    page_1 = index_data[0]
    assert page_1["page_num"] == 1
    assert len(page_1["text_nodes"]) >= 1
    assert page_1["text_nodes"][0]["text"] == "Sample Document Paragraph"

    assert len(page_1["figure_nodes"]) == 1
    assert page_1["figure_nodes"][0]["base64_png"].startswith("data:image/png;base64,")


def test_spatial_indexer_file_path_input(sample_pdf_path):
    """Tests spatial index extraction using a string file path."""
    indexer = FastPDFSpatialIndexer()
    index_data = indexer.extract_spatial_index(sample_pdf_path)

    assert len(index_data) == 1
    assert index_data[0]["page_num"] == 1


def test_spatial_indexer_ignores_small_icons(create_pdf_bytes):
    """Tests that images <= 40x40 in size are excluded from figure_nodes."""
    pdf_bytes = create_pdf_bytes([
        {
            "images": [{"rect": (100, 100, 130, 130)}]  # 30x30 image
        }
    ])

    indexer = FastPDFSpatialIndexer()
    index_data = indexer.extract_spatial_index(pdf_bytes)

    assert len(index_data[0]["figure_nodes"]) == 0


# =====================================================================
# 4. UNIT & INTEGRATION TESTS: PDFConverterService
# =====================================================================

def test_convert_pdf_to_html_success_flow(create_pdf_bytes):
    """Tests converting a PDF into complete HTML view."""
    pdf_bytes = create_pdf_bytes([
        {
            "texts": [{"pos": (50, 50), "text": "Standard Paragraph Text"}],
            "images": [{"rect": (100, 200, 200, 300)}]
        }
    ])

    service = PDFConverterService()
    html_output = service.convert_pdf_to_html(pdf_bytes, document_title="Test Doc")

    assert "<!DOCTYPE html>" in html_output
    assert "<title>Test Doc</title>" in html_output
    assert 'class="pdf-page-container"' in html_output
    assert 'class="patens-pdf-block"' in html_output
    assert 'data-clean-text="Standard Paragraph Text"' in html_output
    assert 'class="patens-pdf-figure"' in html_output


def test_convert_pdf_to_html_escapes_xss_in_title_and_content(create_pdf_bytes):
    """Tests HTML escaping in title and extracted block text."""
    malicious_title = "<script>alert('xss')</script>"
    pdf_bytes = create_pdf_bytes([
        {"texts": [{"pos": (50, 50), "text": 'Text with <script> and "quotes"'}]}
    ])

    service = PDFConverterService()
    html_output = service.convert_pdf_to_html(pdf_bytes, document_title=malicious_title)

    # Title should be escaped
    assert "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;" in html_output
    # Paragraph content attribute should be escaped
    assert "Text with &lt;script&gt; and &quot;quotes&quot;" in html_output


def test_convert_pdf_to_html_formula_generates_cropped_media_attr(create_pdf_bytes):
    """Tests that blocks with formulas generate high-resolution cropped base64 images."""
    pdf_bytes = create_pdf_bytes([
        {"texts": [{"pos": (50, 50), "text": "Formula: \\int_0^\\infty x dx"}]}
    ])

    service = PDFConverterService()
    html_output = service.convert_pdf_to_html(pdf_bytes)

    assert 'data-media-b64="data:image/png;base64,' in html_output


def test_convert_pdf_to_html_invalid_pdf_bytes_raises_value_error():
    """Tests raising ValueError when provided invalid/corrupted PDF bytes."""
    service = PDFConverterService()
    invalid_bytes = b"Not a valid PDF file content"

    with pytest.raises(ValueError, match="Invalid or corrupted PDF source."):
        service.convert_pdf_to_html(invalid_bytes)


def test_convert_pdf_to_html_invalid_filepath_raises_value_error(tmp_path):
    """Tests raising ValueError when provided non-existent file path."""
    service = PDFConverterService()
    missing_file = str(tmp_path / "non_existent.pdf")

    with pytest.raises(ValueError, match="Invalid or corrupted PDF source."):
        service.convert_pdf_to_html(missing_file)


def test_convert_pdf_to_html_multi_page_pdf(create_pdf_bytes):
    """Tests HTML generation across multiple PDF pages."""
    pdf_bytes = create_pdf_bytes([
        {"texts": [{"pos": (50, 50), "text": "Page One Content"}]},
        {"texts": [{"pos": (50, 50), "text": "Page Two Content"}]},
    ])

    service = PDFConverterService()
    html_output = service.convert_pdf_to_html(pdf_bytes)

    assert 'data-page="1"' in html_output
    assert 'data-page="2"' in html_output
    assert "Page One Content" in html_output
    assert "Page Two Content" in html_output