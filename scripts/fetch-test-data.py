"""Download a reproducible 18-image ODbL subset using ZIP byte ranges, no full 2.7 GB download.
Run: python3 scripts/fetch-test-data.py (Python stdlib only).
"""
import urllib.request, struct, json, zlib, hashlib, pathlib, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]/'test-data'
RECORD='https://zenodo.org/api/records/19703357'
def get(url,start=None,end=None):
    headers={'User-Agent':'WingNormalizerResearch/0.2'}
    if start is not None: headers['Range']=f'bytes={start}-{end}'
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=90) as r:
        if start is not None and r.status!=206: raise RuntimeError('Server must support byte ranges')
        return r.read()
record=json.loads(get(RECORD)); archive=next(f for f in record['files'] if f['key'].endswith('.zip'));url=archive['links']['self'];size=archive['size']
tail=get(url,size-100000,size-1);p=tail.find(b'PK\x01\x02');entries=[]
while p>=0 and tail[p:p+4]==b'PK\x01\x02':
    v=struct.unpack_from('<4s6H3I5H2I',tail,p);n,e,c=v[10:13];name=tail[p+46:p+46+n].decode();entries.append((name,v[8],v[-1]));p+=46+n+e+c
selected=[]
for species in ['cryptarum','lucorum','terrestris']:
    for sex in ['F','M']:
        group=[r for r in entries if r[0].startswith(species+'-'+sex+'-')]
        selected.extend(group[i] for i in [0,len(group)//2,len(group)-1])
metadata=[]
for name,length,offset in selected:
    path=ROOT/'difficult'/name;path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists():
        chunk=get(url,offset,offset+length+4096);v=struct.unpack_from('<4s5H3I2H',chunk);start=30+v[-2]+v[-1];packed=chunk[start:start+length];raw=zlib.decompress(packed,-15) if v[3]==8 else packed
        if zlib.crc32(raw)&0xffffffff!=v[6]: raise RuntimeError('ZIP CRC mismatch: '+name)
        path.write_bytes(raw)
    parts=name.split('-');metadata.append({'file':'difficult/'+name,'sourceUrl':'https://zenodo.org/records/19703357','sourceName':record['metadata']['title'],'author':'Bartłomiej Molasy; Adam Tofilski','license':'ODbL-1.0 (record-level license)','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','species':'Bombus '+parts[0],'genus':'Bombus','sex':{'F':'female','M':'male'}[parts[1]],'sexEvidence':'filename F/M; not independently verified','locality':None,'imageType':'venation','citation':'Molasy, B.; Tofilski, A. (2026). Fore wing images of Bombus cryptarum, B. lucorum, and B. terrestris. Zenodo. doi:10.5281/zenodo.19703357','downloadDate':datetime.date.today().isoformat(),'originalSide':'left' if '-L.' in name else 'right','specimenId':name.rsplit('-',1)[0],'repeatCapture':None,'pairedSideNote':'L/R denote opposite wings, not repeat exposures of the same wing','archiveMember':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'tags':['bright-background','partial-wing','edge-contact','small-artifacts'],'assessment':'Visually inspected: clipped wing base; difficult case, not complete contour ground truth'})
    print(name,flush=True)
if (ROOT/'metadata.json').exists():
    metadata += [r for r in json.loads((ROOT/'metadata.json').read_text()) if 'Molasy' not in r['author']]
(ROOT/'metadata.json').write_text(json.dumps(metadata,indent=2,ensure_ascii=False)+'\n')
(ROOT/'source-record.json').write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n')
for f in record['files']:
    if f['key'].endswith('.csv'):
        data=get(f['links']['self']);(ROOT/'landmarks-original.csv').write_bytes(data)
