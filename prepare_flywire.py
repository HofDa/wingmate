#!/usr/bin/env python3
"""Convert a FlyWire/Codex connection CSV into a compact JSON graph for the browser MVP.

Examples:
  python prepare_flywire.py connections.csv flywire-subgraph.json \
    --source-col pre_root_id --target-col post_root_id --weight-col syn_count \
    --min-weight 5 --max-nodes 20000 --max-edges 150000

If your exported CSV uses different column names, pass them explicitly.
The output uses integer node indices to keep the browser file small:
  {"nodes": [original IDs...], "edges": [[srcIndex,dstIndex,weight], ...]}
"""
import argparse, csv, json, heapq
from collections import defaultdict


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument('input_csv')
    p.add_argument('output_json')
    p.add_argument('--source-col', default='pre_root_id')
    p.add_argument('--target-col', default='post_root_id')
    p.add_argument('--weight-col', default='syn_count')
    p.add_argument('--min-weight', type=float, default=5)
    p.add_argument('--max-nodes', type=int, default=20000)
    p.add_argument('--max-edges', type=int, default=150000)
    p.add_argument('--node-list', help='Optional text/CSV file; first token of each line is an allowed node/root ID')
    return p.parse_args()


def load_allowed(path):
    if not path: return None
    out=set()
    with open(path,encoding='utf-8-sig') as f:
        for line in f:
            tok=line.strip().split(',')[0].strip()
            if tok and not tok.lower().startswith(('root','id','cell')): out.add(tok)
    return out


def main():
    a=parse_args(); allowed=load_allowed(a.node_list)
    edges=[]; strength=defaultdict(float)
    with open(a.input_csv,encoding='utf-8-sig',newline='') as f:
        r=csv.DictReader(f)
        missing=[c for c in (a.source_col,a.target_col,a.weight_col) if c not in (r.fieldnames or [])]
        if missing: raise SystemExit(f'Missing columns {missing}. Found: {r.fieldnames}')
        for row in r:
            s=str(row[a.source_col]).strip(); t=str(row[a.target_col]).strip()
            if allowed is not None and (s not in allowed or t not in allowed): continue
            try:w=float(row[a.weight_col])
            except:continue
            if w<a.min_weight or not s or not t or s==t: continue
            edges.append((w,s,t));strength[s]+=w;strength[t]+=w
    if not edges: raise SystemExit('No edges survived the filters.')
    if len(strength)>a.max_nodes:
        keep={n for _,n in heapq.nlargest(a.max_nodes,((v,k) for k,v in strength.items()))}
        edges=[e for e in edges if e[1] in keep and e[2] in keep]
    if len(edges)>a.max_edges: edges=heapq.nlargest(a.max_edges,edges,key=lambda x:x[0])
    nodes=sorted({s for _,s,t in edges}|{t for _,s,t in edges})
    idx={n:i for i,n in enumerate(nodes)}
    out={'format':'bee-fly-connectome-graph-v1','nodes':nodes,'edges':[[idx[s],idx[t],w] for w,s,t in edges]}
    with open(a.output_json,'w',encoding='utf-8') as f: json.dump(out,f,separators=(',',':'))
    print(f'Wrote {len(nodes):,} nodes and {len(edges):,} directed edges to {a.output_json}')

if __name__=='__main__': main()
