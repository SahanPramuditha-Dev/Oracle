"""Generate an explicitly synthetic OCR/QR acceptance label; no camera or network access."""
from pathlib import Path
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
folder = ROOT / 'data/readiness/reading-fixtures'
folder.mkdir(parents=True, exist_ok=True)
picture = Image.new('RGB', (1200, 600), 'white')
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 38)
ImageDraw.Draw(picture).multiline_text((40, 70), 'ORACLE CAMERA TEST\nBATCH A12345\nEXPIRY 2028-12-31',
                                     fill='black', font=font, spacing=24)
qr = Image.fromarray(cv2.QRCodeEncoder_create().encode('https://example.com/oracle-test'))
qr = ImageOps.expand(qr, border=4, fill=255).resize((330, 330), Image.Resampling.NEAREST)
picture.paste(qr, (820, 70))
picture.save(folder / 'label-qr.png')
print('Synthetic reading fixture ready in data/readiness/reading-fixtures/label-qr.png')
