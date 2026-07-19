#!/usr/bin/env python3
"""
upscale.py — super-resolve panel crops with OpenCV dnn_superres.

Source art for this project is low-res (~1024px page), so panels are small
(87-568px wide). Plain interpolation looks mushy/pixelated; CNN super-res is
much cleaner.

Models (download once into ./models/):
  FSRCNN_x4.pb  https://github.com/Saafke/FSRCNN_Tensorflow/raw/master/models/FSRCNN_x4.pb
  EDSR_x4.pb    https://github.com/Saafke/EDSR_Tensorflow/raw/master/models/EDSR_x4.pb   (optional, higher quality, ~90s/panel on CPU)

Recommendation: FSRCNN x4 — sub-second per panel, clean enough. EDSR only if
you want max quality on the tiny speech-bubble panels and can wait.

Usage:
  python upscale.py IN_DIR OUT_DIR [--model FSRCNN_x4.pb --name fsrcnn --scale 4 --max 1800 --q 90]
"""
import sys, os, glob, argparse, cv2

def main(a):
    sr=cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(a.model); sr.setModel(a.name, a.scale)
    os.makedirs(a.out, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(a.inp,'*.png'))):
        if os.path.basename(f).startswith('_'): continue
        up=sr.upsample(cv2.imread(f))
        h,w=up.shape[:2]; m=max(h,w)
        if m>a.max:
            s=a.max/m; up=cv2.resize(up,(round(w*s),round(h*s)),interpolation=cv2.INTER_AREA)
        name=os.path.splitext(os.path.basename(f))[0]+'.webp'
        cv2.imwrite(os.path.join(a.out,name), up, [cv2.IMWRITE_WEBP_QUALITY,a.q])
        print('  ',name, f'{up.shape[1]}x{up.shape[0]}')

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument('inp'); p.add_argument('out')
    p.add_argument('--model',default='models/FSRCNN_x4.pb')
    p.add_argument('--name',default='fsrcnn'); p.add_argument('--scale',type=int,default=4)
    p.add_argument('--max',type=int,default=1800); p.add_argument('--q',type=int,default=90)
    main(p.parse_args())
