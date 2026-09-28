"""Extract S2 panels from Spiesman et al. (2024), CC BY 4.0.
Usage: python3 scripts/extract-publication-panels.py /path/to/journal.pone.0303383.s001.docx
Requires Pillow. Only crops; preserves source RGB without enhancement.
"""
import sys,zipfile,json,hashlib,datetime
from pathlib import Path
from PIL import Image
from io import BytesIO
root=Path(__file__).resolve().parents[1]/'test-data'
z=zipfile.ZipFile(sys.argv[1]);raw=z.read('word/media/image2.png');(root/'sources').mkdir(exist_ok=True);(root/'sources'/'Spiesman-2024-S2.png').write_bytes(raw)
im=Image.open(BytesIO(raw))
# Bounds measured in original 1428 x 1499 S2 raster, excluding black panel gutters.
boxes=[(0,0,348,249),(526,0,879,249),(1009,0,1393,249),(0,252,405,499),(526,252,919,499),(1009,252,1428,499),(0,503,506,749),(526,503,988,749),(1009,503,1335,749),(0,754,326,999),(530,754,818,999),(1009,754,1336,999),(0,1005,326,1251),(526,1005,893,1251),(1009,1005,1346,1251),(0,1256,363,1499),(526,1256,881,1499),(1009,1256,1368,1499)]
species=['Agapostemon sericeus','Agapostemon texanus','Bombus bimaculatus','Bombus griseocollis','Bombus impatiens','Bombus perplexus','Bombus sandersoni','Bombus vagans','Ceratina calcarata','Lasioglossum acuminatum','Lasioglossum admirandum','Lasioglossum coriaceum','Lasioglossum leucozonium','Lasioglossum oceanicum','Lasioglossum pilosum','Lasioglossum versatum','Lasioglossum zephyrus','Lasioglossum zonulus']
metadata=json.loads((root/'metadata.json').read_text());metadata=[r for r in metadata if 'Spiesman' not in r['author']]
for i,(box,taxon) in enumerate(zip(boxes,species)):
    letter=chr(65+i);name=f'Spiesman-S2-{letter}-{taxon.replace(" ","-")}.png';folder='venation' if letter=='F' else 'difficult';p=root/folder/name;im.crop(box).save(p)
    metadata.append({'file':folder+'/'+name,'sourceUrl':'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0303383.s001&type=supplementary','sourceName':'Spiesman et al. 2024, S1 File, Fig S2, panel '+letter,'author':'Brian J Spiesman; Claudio Gratton; Elena Gratton; Heather Hines','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','species':taxon,'genus':taxon.split()[0],'sex':None if taxon.startswith('Bombus') else 'female','locality':None,'imageType':'venation','citation':'Spiesman et al. (2024). Deep learning for identifying bee species from images of wings and pinned specimens. PLOS ONE 19(5):e0303383. doi:10.1371/journal.pone.0303383','downloadDate':datetime.date.today().isoformat(),'derivation':{'source':'sources/Spiesman-2024-S2.png','cropXYXY':box,'operation':'crop only; no resize or color changes'},'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'tags':['bright-background','low-resolution','panel-label']+([] if letter=='F' else ['partial-wing'])+(['damaged-wing'] if letter in 'HJP' else []),'assessment':'Published, taxon-labelled forewing; panel F near-complete; other panels clipped at base and/or tip; use for REVIEW and segmentation stress tests','specimenId':None,'repeatCapture':None})
(root/'metadata.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
