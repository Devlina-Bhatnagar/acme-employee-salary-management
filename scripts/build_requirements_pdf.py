"""Render the pre-build requirements document to a single-page, print-ready PDF.

Optional tooling: pip install reportlab pypdf
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'REQUIREMENTS.md'
OUTPUT = ROOT / 'docs' / 'requirements-one-page.pdf'
styles = {
    'title': ParagraphStyle('TitleACME', fontName='Helvetica-Bold', fontSize=16, leading=19, textColor=colors.HexColor('#182342'), spaceAfter=10),
    'h2': ParagraphStyle('SectionACME', fontName='Helvetica-Bold', fontSize=10, leading=13, textColor=colors.HexColor('#5262CE'), spaceBefore=8, spaceAfter=4),
    'text': ParagraphStyle('TextACME', fontName='Helvetica', fontSize=8, leading=10.6, textColor=colors.HexColor('#34425A'), spaceAfter=3),
    'bullet': ParagraphStyle('BulletACME', fontName='Helvetica', fontSize=8, leading=10.4, textColor=colors.HexColor('#34425A'), leftIndent=12, firstLineIndent=-9, spaceAfter=3),
}


def inline(value: str) -> str:
    # Strip markdown bold and backtick punctuation while preserving emphasis.
    value = html.escape(value)
    value = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', value)
    value = re.sub(r'`([^`]+)`', r'<font name="Courier">\1</font>', value)
    return value.replace('  ', ' ')


contents = []
for line in SOURCE.read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line:
        continue
    if line.startswith('# '):
        contents.append(Paragraph(inline(line[2:]), styles['title']))
    elif line.startswith('## '):
        contents.append(Paragraph(inline(line[3:]), styles['h2']))
    elif re.match(r'^\d+\. ', line):
        contents.append(Paragraph(re.sub(r'^\d+\. ', '• ', inline(line)), styles['bullet']))
    elif line.startswith('- '):
        contents.append(Paragraph('• ' + inline(line[2:]), styles['bullet']))
    else:
        contents.append(Paragraph(inline(line), styles['text']))


def footer(canvas, doc):
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(colors.HexColor('#e3e7f0'))
    canvas.line(38, 35, width - 38, 35)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(colors.HexColor('#8c98aa'))
    canvas.drawString(38, 22, 'ACME • Salary Management Assessment • Product requirements v1')
    canvas.drawRightString(width - 38, 22, f'Page {doc.page}')
    canvas.restoreState()


doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, topMargin=35, bottomMargin=48, leftMargin=38, rightMargin=38, title='ACME Salary Manager — Product requirements v1')
doc.build(contents, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
