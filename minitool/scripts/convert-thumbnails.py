"""Re-encode thumbnails losslessly; verify decoded pixels are unchanged."""
from pathlib import Path
import json
from PIL import Image
root=Path(__file__).resolve().parents[2]
manifest=json.loads((root/'public/thumbnails/style-manifest.json').read_text())
output=root/'minitool/dist/thumbnails'
count=0;before=0;after=0
for style,products in manifest.items():
 for product in products:
  source=root/'public/thumbnails'/style/(product+'.png')
  target=output/style/(product+'.webp');target.parent.mkdir(parents=True,exist_ok=True)
  with Image.open(source) as im:
   pixels=im.convert('RGBA')
   pixels.save(target,'WEBP',lossless=True,method=6,exact=True)
   with Image.open(target) as encoded:
    assert pixels.size == encoded.size and pixels.tobytes() == encoded.convert('RGBA').tobytes(),'Decoded thumbnail pixels changed'
  count+=1;before+=source.stat().st_size;after+=target.stat().st_size
print(json.dumps({'thumbnails':count,'pngBytes':before,'losslessWebpBytes':after,'pixelContent':'unchanged'}))
