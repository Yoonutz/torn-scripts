#!/usr/bin/env python3
"""
extract_panels.py — detect comic panels in a full page image and tight-crop them.

Pipeline:
  1. Detect horizontal black gutters -> row bands.
  2. Within each band, detect vertical black gutters -> panel columns.
  3. Tight-trim each panel to its non-black content bbox (removes gutter slivers).
  4. Emit crops + a layout.json (rows of {x0,y0,x1,y1}).

Usage:
  python extract_panels.py SOURCE.png OUT_DIR
Then verify OUT_DIR/_overlay.png before using the crops.

Notes:
  - Thresholds (BLACK=22, content fracs) were tuned for the Covenant source art.
    A new comic with different gutter darkness may need tweaks.
  - Detection is heuristic. ALWAYS eyeball _overlay.png; comics with non-black
    gutters or borderless panels will need manual band/segment overrides.
"""
import sys, os, json, cv2, numpy as np

BLACK = 22  # pixel value below which a pixel counts as "gutter/black"

def runs(idx, minlen):
    out=[]
    if len(idx)==0: return out
    s=p=int(idx[0])
    for i in idx[1:]:
        i=int(i)
        if i==p+1: p=i
        else:
            if p-s+1>=minlen: out.append((s,p))
            s=p=i
    if p-s+1>=minlen: out.append((s,p))
    return out

def tight(mask, y0,y1,x0,x1, thr=0.03, pad=1):
    sub=mask[y0:y1,x0:x1]
    cols=np.where(sub.mean(axis=0)>thr)[0]; rows=np.where(sub.mean(axis=1)>thr)[0]
    if len(cols)==0 or len(rows)==0: return (x0,y0,x1,y1)
    return (max(0,x0+int(cols[0])-pad),  max(0,y0+int(rows[0])-pad),
            min(mask.shape[1],x0+int(cols[-1])+1+pad), min(mask.shape[0],y0+int(rows[-1])+1+pad))

def main(src, outdir):
    os.makedirs(outdir, exist_ok=True)
    img=cv2.imread(src); h,w=img.shape[:2]
    mask=(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)>BLACK).astype(np.uint8)

    # horizontal gutters -> bands
    hg=runs(np.where(mask.mean(axis=1)<0.06)[0], 2)
    edges=[0]+[ (a+b)//2 for (a,b) in hg ]+[h]
    edges=sorted(set(edges))
    bands=[(edges[i],edges[i+1]) for i in range(len(edges)-1) if edges[i+1]-edges[i]>40]

    boxes=[]; overlay=img.copy()
    for (y0,y1) in bands:
        cf=mask[y0:y1,:].mean(axis=0)
        vg=runs(np.where(cf<0.05)[0],4)
        cuts=sorted(set([0]+[(a+b)//2 for (a,b) in vg]+[w]))
        row=[]
        for i in range(len(cuts)-1):
            x0,x1=cuts[i],cuts[i+1]
            if x1-x0<55 or mask[y0:y1,x0:x1].mean()<0.12: continue
            row.append(tight(mask,y0,y1,x0,x1))
        if row: boxes.append(row)

    pages=[]
    for r,rw in enumerate(boxes,1):
        page=[]
        for c,(x0,y0,x1,y1) in enumerate(rw,1):
            cv2.imwrite(f'{outdir}/p{r}_{c}.png', img[y0:y1,x0:x1])
            cv2.rectangle(overlay,(x0,y0),(x1,y1),(0,255,0),2)
            page.append({"file":f"p{r}_{c}.png","x0":x0,"y0":y0,"x1":x1,"y1":y1,
                         "ar":round((x1-x0)/(y1-y0),3)})
        pages.append(page)
    cv2.imwrite(f'{outdir}/_overlay.png', overlay)
    json.dump({"source":src,"size":[w,h],"pages":pages}, open(f'{outdir}/layout.json','w'), indent=2)
    print("rows:",[len(p) for p in pages],"total:",sum(len(p) for p in pages))
    print("Verify:",f'{outdir}/_overlay.png')

if __name__=="__main__":
    if len(sys.argv)!=3: print(__doc__); sys.exit(1)
    main(sys.argv[1], sys.argv[2])
