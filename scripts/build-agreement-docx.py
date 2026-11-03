import json
import sys

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

blocks = json.load(sys.stdin)
doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Inches(8.5), Inches(11)
section.top_margin = section.bottom_margin = Inches(0.55)
section.left_margin = section.right_margin = Inches(0.65)
section.footer_distance = Inches(0.25)
for name in ('Normal', 'Title', 'Heading 1'):
    style = doc.styles[name]
    style.font.name = 'Arial'
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.paragraph_format.widow_control = True
    for border in list(style._element.xpath('./w:pPr/w:pBdr')):
        border.getparent().remove(border)
normal = doc.styles['Normal']
normal.font.size = Pt(10.5)
normal.paragraph_format.line_spacing = 1.0
normal.paragraph_format.space_after = Pt(2)
title = doc.styles['Title']
title.font.size = Pt(17)
title.font.bold = True
title.paragraph_format.space_after = Pt(7)
title.paragraph_format.keep_with_next = True
heading = doc.styles['Heading 1']
heading.font.size = Pt(11)
heading.font.bold = True
heading.paragraph_format.space_before = Pt(5)
heading.paragraph_format.space_after = Pt(2)
heading.paragraph_format.keep_with_next = True

for block in blocks:
    if block.get('pageBreak'):
        doc.add_page_break()
    kind = block['type']
    if kind == 'table':
        table = doc.add_table(rows=0, cols=5)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        widths = [0.3, 3.35, 0.55, 1.2, 1.8]
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
                for side, value in [('top', '80'), ('bottom', '80'), ('left', '90'), ('right', '90')]:
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
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT if column == 1 else WD_ALIGN_PARAGRAPH.CENTER
                run = p.add_run(text)
                run.font.size = Pt(9.5)
                run.bold = index == 0
        doc.add_paragraph().paragraph_format.space_after = Pt(0)
    elif kind == 'signatures':
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(5)
        p.paragraph_format.keep_together = True
        p.add_run('Продавець ____________________          Покупець ____________________')
    elif kind == 'title':
        doc.add_paragraph(block['text'], style='Title')
    elif kind == 'heading':
        doc.add_paragraph(block['text'], style='Heading 1')
    elif kind == 'field':
        p = doc.add_paragraph()
        p.add_run(block['label'] + ': ').bold = True
        p.add_run(block['text'])
    else:
        p = doc.add_paragraph(block['text'])
        if kind == 'total':
            p.runs[0].bold = True

footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
footer.add_run('EVLine | Шаблон 03.11.2026 | ').font.size = Pt(8)
field = OxmlElement('w:fldSimple')
field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)
doc.core_properties.title = 'Договір замовлення автозапчастин EVLine'
doc.core_properties.author = 'EVLine'
doc.core_properties.subject = 'Скорочений договір і специфікація від 03.11.2026'
doc.save(sys.argv[1])
