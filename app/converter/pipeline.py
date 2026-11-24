import json, os, re, shutil, subprocess, threading
from pathlib import Path
import cv2, fitz, numpy as np, pytesseract
from lxml import etree as E
from music21 import instrument
import store, scorexml

def page_range(value, total):
    if not value: return list(range(total))
    if not re.fullmatch(r'[0-9,\s-]+',value): raise ValueError('Use page ranges such as 1-4, 8, 12-14.')
    pages=set()
    for segment in value.split(','):
        ends=[int(x.strip()) for x in segment.split('-')]
        if len(ends)>2 or not ends or min(ends)<1 or max(ends)>total or ends[0]>ends[-1]:
            raise ValueError(f'Page range must be between 1 and {total}.')
        pages.update(range(ends[0]-1,ends[-1]))
    return sorted(pages)

def preprocess(gray, sensitivity):
    # Orientation is confidence-gated; deskew estimates near-horizontal staff segments.
    try:
        osd=pytesseract.image_to_osd(gray,output_type=pytesseract.Output.DICT,timeout=30)
        rotation=int(osd.get('rotate',0)) if float(osd.get('orientation_conf',0))>=5 else 0
        if rotation==90: gray=cv2.rotate(gray,cv2.ROTATE_90_CLOCKWISE)
        elif rotation==180: gray=cv2.rotate(gray,cv2.ROTATE_180)
        elif rotation==270: gray=cv2.rotate(gray,cv2.ROTATE_90_COUNTERCLOCKWISE)
    except (RuntimeError,pytesseract.TesseractError): pass
    lines=cv2.HoughLinesP(cv2.Canny(gray,50,150),1,np.pi/1800,150,minLineLength=gray.shape[1]//5,maxLineGap=25)
    if lines is not None:
        angles=[np.degrees(np.arctan2(y2-y1,x2-x1)) for x1,y1,x2,y2 in np.asarray(lines).reshape(-1,4) if x2!=x1 and abs(np.degrees(np.arctan2(y2-y1,x2-x1)))<5]
        if angles:
            angle=float(np.median(angles));h,w=gray.shape
            if abs(angle)>.08:
                matrix=cv2.getRotationMatrix2D((w/2,h/2),angle,1)
                gray=cv2.warpAffine(gray,matrix,(w,h),flags=cv2.INTER_CUBIC,borderValue=255)
    low,high=np.percentile(gray,[2,98])
    if high-low<150 and high>low: gray=np.clip((gray.astype(float)-low)*255/(high-low),0,255).astype(np.uint8)
    if sensitivity=='faint': gray=cv2.createCLAHE(clipLimit=2,tileGridSize=(16,16)).apply(gray)
    return gray

def ocr_audit(gray, language):
    # Keep OCR evidence for QA. Only Audiveris' geometric note/lyric associations
    # enter MusicXML; free-floating OCR text is never assigned to arbitrary notes.
    binary=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)[1]
    horizontal=cv2.morphologyEx(binary,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(30,gray.shape[1]//12),1)))
    rows=np.flatnonzero((horizontal>0).sum(axis=1)>gray.shape[1]*.25)
    bands=[]
    for row in rows:
        if not bands or row-bands[-1][-1]>2: bands.append([int(row)])
        else: bands[-1].append(int(row))
    lines=[int(np.mean(b)) for b in bands];staves=[]
    for i in range(len(lines)-4):
        group=lines[i:i+5]; gaps=np.diff(group)
        if min(gaps)>3 and max(gaps)<min(gaps)*1.4:
            if not staves or group[0]>staves[-1][-1]:staves.append(group)
    # OCR left-side labels, then crop immediately below vocal staves. Native OCR
    # handles unnamed/shared SATB staves; these supplemental regions are review aids.
    labels=pytesseract.image_to_data(gray[:,:max(1,gray.shape[1]//5)],lang=language,config='--psm 11',output_type=pytesseract.Output.DICT,timeout=90)
    vocal=[]
    for i,text in enumerate(labels['text']):
        if re.search(r'soprano|alto|tenor|bass|coro|choir|solo|SATB',text,re.I):
            y=labels['top'][i]+labels['height'][i]//2
            if staves:
                staff=min(staves,key=lambda s:abs(sum(s)/5-y)); start=staff[-1]+3
                end=min([s[0]-3 for s in staves if s[0]>start]+[start+int(np.median(np.diff(staff))*8),gray.shape[0]])
                if end>start:
                    data=pytesseract.image_to_data(gray[start:end],lang=language,config='--psm 6 -c preserve_interword_spaces=1',output_type=pytesseract.Output.DICT,timeout=90)
                    vocal.append({'label':text,'y':start,'height':end-start,'tokens':[{'text':t,'x':data['left'][j],'y':start+data['top'][j],'confidence':data['conf'][j]} for j,t in enumerate(data['text']) if t.strip()]})
    return {'staff_count':len(staves),'vocal_regions':vocal}

def apply_options(root, opts):
    if not opts.get('lyrics',True):
        for lyric in root.findall('.//lyric'): lyric.getparent().remove(lyric)
    if opts.get('transposing',True):
        for part in root.findall('part'):
            if part.find('.//transpose') is not None:continue
            name=root.findtext(f"part-list/score-part[@id='{part.get('id')}']/part-name",'')
            try: trans=instrument.fromString(name).transposition
            except Exception: trans=None
            if trans and trans.chromatic.semitones:
                attrs=part.find('measure/attributes')
                if attrs is not None:
                    element=E.Element('transpose');E.SubElement(element,'diatonic').text=str(trans.generic.directed-(-1 if trans.generic.directed<0 else 1));E.SubElement(element,'chromatic').text=str(int(trans.chromatic.semitones))
                    position=next((i for i,x in enumerate(attrs) if x.tag=='measure-style'),len(attrs));attrs.insert(position,element)
    return root

def run(job):
    jid=job['id'];pid=job['project_id'];opts=job['options'];folder=store.ROOT/pid/jid;folder.mkdir(parents=True,exist_ok=True)
    source=store.ROOT/pid/'original.pdf';prepped=folder/'prepared.pdf';selected=[];audit=[]
    try:
        with fitz.open(source) as pdf:
            selected=page_range(opts.get('range',''),len(pdf));prepared=fitz.open()
            for index,p in enumerate(selected):
                store.update(jid,'rasterising',int(5+25*index/len(selected)),f'Rasterising page {p+1} of {len(pdf)} at 300 DPI')
                page=pdf[p]
                if page.rect.width*page.rect.height*(300/72)**2>60_000_000: raise ValueError('Page is too large to rasterise safely at 300 DPI.')
                pix=page.get_pixmap(dpi=300,colorspace=fitz.csGRAY,alpha=False)
                gray=preprocess(np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.height,pix.width),opts.get('sensitivity','standard'))
                image=cv2.imencode('.png',gray)[1].tobytes();h,w=gray.shape
                target=prepared.new_page(width=w*72/300,height=h*72/300);target.insert_image(target.rect,stream=image)
                if opts.get('lyrics',True):
                    store.update(jid,'lyrics',int(7+25*index/len(selected)),f'OCR audit of vocal staff regions on page {p+1}')
                    audit.append({'page':p+1,**ocr_audit(gray,opts.get('language','eng'))})
            prepared.save(prepped,deflate=True);prepared.close()
        (folder/'ocr-audit.json').write_text(json.dumps(audit,ensure_ascii=False),encoding='utf-8')
        store.update(jid,'staves',35,'Detecting systems and recognizing notation; page progress follows the OMR engine log.')
        command=[os.environ.get('AUDIVERIS_BIN','audiveris'),'-batch','-transcribe','-export','-save','-swap','-constant',f"org.audiveris.omr.text.Language.defaultSpecification={opts.get('language','eng')}",'-output',str(folder/'omr'),'--',str(prepped)]
        with (folder/'audiveris.log').open('w') as log:
            process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
            timer=threading.Timer(int(os.environ.get('OMR_TIMEOUT','14400')),process.kill);timer.start()
            try:
                for line in process.stdout:
                    log.write(line);log.flush()
                    stage=next((s for pattern,s in [('GRID|HEADERS','staves'),('HEADS|STEMS|BEAMS|RHYTHMS','notation'),('TEXTS|LYRICS','lyrics'),('PAGE|Export','building')] if re.search(pattern,line)),None)
                    if stage: store.update(jid,stage,{'staves':40,'notation':55,'lyrics':70,'building':85}[stage],line.strip()[-350:])
                if process.wait()!=0: raise ValueError('OMR engine failed or exceeded its time limit. Inspect the worker log and retry a smaller excerpt.')
            finally:
                timer.cancel()
                if process.poll() is None:process.kill();process.wait()
        outputs=sorted((folder/'omr').rglob('*.mxl'))
        if not outputs:outputs=sorted((folder/'omr').rglob('*.musicxml'))
        if len(outputs)!=1: raise ValueError(f'OMR exported {len(outputs)} movements. This score needs manual movement/part review before it can be combined safely.')
        root=apply_options(scorexml.load(outputs[0]),opts)
        store.update(jid,'building',92,'Validating MusicXML 4.0 schema and rhythmic structure')
        root.set('version','4.0')
        report=scorexml.validate(root,opts.get('lyrics',True));report['pages']= [p+1 for p in selected]
        report['warnings'].append('Recognition requires visual review. Dense voices, instrument labels and multilingual syllable alignment are not guaranteed.')
        scorexml.artifacts(root,folder/'output')
        # Atomic pointer switch: failed retries never replace a previous successful score.
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            revision=db.execute('SELECT revision FROM projects WHERE id=?',(pid,)).fetchone()[0]+1
            relative=str((folder/'output').relative_to(store.ROOT))
            db.execute('UPDATE projects SET revision=?,active_output=? WHERE id=?',(revision,relative,pid))
            db.execute('INSERT INTO revisions VALUES(?,?,?,?,?)',(pid,revision,relative,__import__('time').time(),json.dumps(report)))
        store.update(jid,'complete',100,'Conversion ready for visual review','complete',report)
    except Exception as error:
        store.update(jid,'failed',0,str(error)[:1500],'failed')
