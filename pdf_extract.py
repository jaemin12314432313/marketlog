from pathlib import Path
try:
    from PyPDF2 import PdfReader
except ImportError:
    raise SystemExit('MISSING_PYPDF2')
path = Path(r'C:\Users\AN\Downloads\marketlog\Maps 개요.pdf')
reader = PdfReader(path)
print('PAGES', len(reader.pages))
for i, page in enumerate(reader.pages):
    text = page.extract_text() or ''
    print('--- PAGE', i+1, '---')
    print(text[:1200])
