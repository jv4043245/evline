import json
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

blocks = json.load(sys.stdin)
doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Inches(8.27), Inches(11.69)
section.top_margin, section.bottom_margin = Inches(0.72), Inches(0.58)
section.left_margin = section.right_margin = Inches(0.65)
section.header_distance = Inches(0.22)
section.footer_distance = Inches(0.24)
section.different_first_page_header_footer = True
inner_width = section.page_width - section.left_margin - section.right_margin
for name in ('Header', 'Footer'):
    doc.styles[name].paragraph_format.tab_stops.clear_all()
for name in ('Normal', 'Title', 'Heading 1'):
    style = doc.styles[name]
    style.font.name = 'Arial'
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.paragraph_format.widow_control = True
    for border in list(style._element.xpath('./w:pPr/w:pBdr')):
        border.getparent().remove(border)
normal = doc.styles['Normal']
normal.font.size = Pt(10.5)
normal.paragraph_format.line_spacing = 1.04
normal.paragraph_format.space_after = Pt(3)
normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
title = doc.styles['Title']
title.font.size = Pt(16)
title.font.bold = True
title.paragraph_format.space_after = Pt(6)
title.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
title.paragraph_format.keep_with_next = True
heading = doc.styles['Heading 1']
heading.font.size = Pt(11)
heading.font.bold = True
heading.paragraph_format.space_before = Pt(5)
heading.paragraph_format.space_after = Pt(2)
heading.paragraph_format.keep_with_next = True
heading.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT

def website(paragraph):
    link = OxmlElement('w:hyperlink')
    link.set(qn('r:id'), paragraph.part.relate_to('https://evline.com.ua/', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True))
    run = OxmlElement('w:r')
    properties = OxmlElement('w:rPr')
    color = OxmlElement('w:color')
    color.set(qn('w:val'), '3F633D')
    properties.append(color)
    run.append(properties)
    text = OxmlElement('w:t')
    text.text = 'evline.com.ua'
    run.append(text)
    link.append(run)
    paragraph._p.append(link)

header = section.first_page_header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.LEFT
header.paragraph_format.space_after = Pt(0)
header.paragraph_format.tab_stops.add_tab_stop(inner_width, WD_TAB_ALIGNMENT.RIGHT)
logo = header.add_run().add_picture(str(Path(__file__).resolve().parents[1] / 'assets/images/logo.png'), width=Inches(1.08))
logo._inline.docPr.set('descr', 'EVLine')
header.add_run('\t')
website(header)
running_header = section.header.paragraphs[0]
running_header.alignment = WD_ALIGN_PARAGRAPH.LEFT
running_header.paragraph_format.tab_stops.add_tab_stop(inner_width, WD_TAB_ALIGNMENT.RIGHT)
running_header.add_run('EVLine').bold = True
running_header.add_run('\t')
website(running_header)

for block in blocks:
    if block.get('pageBreak'):
        doc.add_page_break()
    kind = block['type']
    if kind == 'table':
        table = doc.add_table(rows=0, cols=5)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        widths = [0.28, 3.17, 0.5, 1.31, 1.71]
        for col, width in zip(table.columns, widths):
            col.width = Inches(width)
        for index, values in enumerate([block['headers'], *block['rows']]):
            row = table.add_row()
            row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
            if index == 0:
                row._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
            for column, (cell, text) in enumerate(zip(row.cells, values)):
                cell.width = Inches(widths[column])
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                properties = cell._tc.get_or_add_tcPr()
                borders = OxmlElement('w:tcBorders')
                for side in ('top', 'left', 'bottom', 'right'):
                    border = OxmlElement('w:' + side)
                    for key, value in [('val', 'single'), ('sz', '4'), ('color', 'D9D9D9')]:
                        border.set(qn('w:' + key), value)
                    borders.append(border)
                properties.append(borders)
                margins = OxmlElement('w:tcMar')
                for side, value in [('top', '95'), ('bottom', '95'), ('left', '100'), ('right', '100')]:
                    margin = OxmlElement('w:' + side)
                    margin.set(qn('w:w'), value)
                    margin.set(qn('w:type'), 'dxa')
                    margins.append(margin)
                properties.append(margins)
                if index == 0:
                    shade = OxmlElement('w:shd')
                    shade.set(qn('w:fill'), 'EAEAEA')
                    properties.append(shade)
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(0)
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER if index == 0 or column in (0, 2) else WD_ALIGN_PARAGRAPH.RIGHT if column in (3, 4) else WD_ALIGN_PARAGRAPH.LEFT
                run = p.add_run(text)
                run.font.size = Pt(9.5)
                run.bold = index == 0
        doc.add_paragraph().paragraph_format.space_after = Pt(0)
    elif kind == 'signatures':
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(5)
        p.paragraph_format.keep_together = True
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.tab_stops.add_tab_stop(inner_width, WD_TAB_ALIGNMENT.RIGHT)
        p.add_run('Продавець ____________________\tПокупець ____________________')
    elif kind == 'title':
        doc.add_paragraph(block['text'], style='Title')
    elif kind == 'heading':
        doc.add_paragraph(block['text'], style='Heading 1')
    elif kind == 'field':
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.add_run(block['label'] + ': ').bold = True
        p.add_run(block['text'])
    else:
        p = doc.add_paragraph(block['text'])
        if kind == 'total':
            p.runs[0].bold = True
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            p.paragraph_format.space_before = Pt(5)
            p.paragraph_format.space_after = Pt(5)
        elif ' · м. ' in block['text']:
            number, city = block['text'].split(' · м. ', 1)
            p.text = number + '\tм. ' + city
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.tab_stops.add_tab_stop(inner_width, WD_TAB_ALIGNMENT.RIGHT)
            p.paragraph_format.space_after = Pt(7)
        elif block['text'].startswith('Додаток №'):
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(7)
        elif block['text'].startswith('Дата підписання'):
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT

for footer in (section.first_page_footer.paragraphs[0], section.footer.paragraphs[0]):
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    field = OxmlElement('w:fldSimple')
    field.set(qn('w:instr'), 'PAGE')
    footer._p.append(field)
doc.core_properties.title = 'Договір замовлення автозапчастин EVLine'
doc.core_properties.author = 'EVLine'
doc.core_properties.subject = 'Скорочений договір і специфікація від 03.11.2026'
doc.save(sys.argv[1])
