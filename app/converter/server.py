import asyncio, hmac, json, os, shutil, time, uuid
from contextlib import asynccontextmanager
from pathlib import Path
import fitz, pytesseract
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import store, pipeline, scorexml
MAX_BYTES=25*1024*1024 # Firebase proxy's 32 MB request ceiling; leave overhead.
class Options(BaseModel):
    preset: str = 'Full Orchestra + Choir'
    lyrics: bool = True
    transposing: bool = True
    range: str = Field(default='',max_length=1000)
    language: str = 'eng'
    sensitivity: str = 'standard'
    def checked(self, pages):
        if self.preset not in ('Full Orchestra + Choir','Orchestra Only','Choir + Piano/Organ','Chamber / Small Ensemble'):raise ValueError('Unknown preset.')
        if self.language not in ('eng','eng+lat','eng+zul','eng+xho','eng+sot'): raise ValueError('Unsupported language.')
        if self.sensitivity not in ('standard','faint'): raise ValueError('Unknown sensitivity.')
        missing=set(self.language.split('+'))-set(pytesseract.get_languages())
        if missing:raise ValueError('Install OCR language data for: '+', '.join(missing))
        pipeline.page_range(self.range,pages)
        return self.model_dump()
def auth(request:Request):
    token=os.environ.get('CONVERTER_SECRET','')
    if len(token)<32 or not hmac.compare_digest(request.headers.get('authorization',''), 'Bearer '+token):raise HTTPException(401,'Unauthorized')
async def work():
    while True:
        job=await asyncio.to_thread(store.claim)
        if job: await asyncio.to_thread(pipeline.run,job)
        else:await asyncio.sleep(2)
@asynccontextmanager
async def lifespan(app):
    store.init();task=asyncio.create_task(work())
    yield
    task.cancel()
app=FastAPI(lifespan=lifespan,dependencies=[Depends(auth)],docs_url=None,redoc_url=None,openapi_url=None)
@app.get('/health')
def health():
    ready=bool(shutil.which(os.environ.get('AUDIVERIS_BIN','audiveris')) and Path(os.environ.get('MUSICXML_XSD','/opt/musicxml/schema/musicxml.xsd')).is_file())
    return {'ready':ready,'engine':'Audiveris + Tesseract','dpi':300,'languages':pytesseract.get_languages(),'max_bytes':MAX_BYTES}
def project(pid):
    value=store.get_project(pid)
    if not value: raise HTTPException(404,'Project not found')
    return value
def output(pid):
    p=project(pid)
    if not p.get('active_output'):raise HTTPException(409,'No validated score is ready yet')
    return store.ROOT/p['active_output']
@app.get('/projects')
def projects():return store.projects()
@app.get('/projects/{pid}')
def details(pid):
    p=project(pid);return dict(p,job=store.get_job(p['current_job']))
@app.post('/projects',status_code=202)
async def create(file: UploadFile=File(...),options:str=Form(...)):
    pid=uuid.uuid4().hex;folder=store.ROOT/pid;folder.mkdir();original=folder/'original.pdf'
    try:
        total=0
        with original.open('wb') as dest:
            while chunk:=await file.read(1024*1024):
                total+=len(chunk)
                if total>MAX_BYTES:raise ValueError('PDF must be 25 MB or smaller. Split a large score into excerpts.')
                dest.write(chunk)
        if original.read_bytes()[:5]!=b'%PDF-':raise ValueError('Choose a PDF file.')
        with fitz.open(original) as pdf:
            if pdf.needs_pass:raise ValueError('Remove PDF password protection first.')
            pages=len(pdf)
            if not 1<=pages<=400:raise ValueError('PDF must have 1–400 pages.')
        opts=Options.model_validate_json(options).checked(pages)
        if not shutil.which(os.environ.get('AUDIVERIS_BIN','audiveris')):raise ValueError('Audiveris is not installed on the worker.')
        with store.connect() as db:db.execute('INSERT INTO projects(id,title,created,updated,pages,options) VALUES(?,?,?,?,?,?)',(pid,Path(file.filename or 'Untitled score.pdf').stem[:200],time.time(),time.time(),pages,json.dumps(opts)))
        jid=store.enqueue(pid,opts)
        return dict(project(pid),job=store.get_job(jid))
    except Exception as error:
        shutil.rmtree(folder,ignore_errors=True)
        with store.connect() as db:db.execute('DELETE FROM projects WHERE id=?',(pid,))
        raise HTTPException(422,str(error))
    finally:await file.close()
@app.post('/projects/{pid}/retry',status_code=202)
def retry(pid,options:Options):
    p=project(pid)
    try:jid=store.enqueue(pid,options.checked(p['pages']))
    except ValueError as e:raise HTTPException(409,str(e))
    return dict(project(pid),job=store.get_job(jid))
@app.get('/projects/{pid}/files/{kind}')
def files(pid,kind):
    project(pid)
    if kind=='original.pdf':return FileResponse(store.ROOT/pid/'original.pdf',media_type='application/pdf')
    if kind not in ('score.musicxml','score.mxl','score.mid','score.pdf'):raise HTTPException(404,'Unknown export')
    directory=output(pid);path=directory/kind
    if not path.exists():raise HTTPException(409,'This export has not been generated.')
    return FileResponse(path,filename=kind,media_type={'score.musicxml':'application/vnd.recordare.musicxml+xml','score.mxl':'application/vnd.recordare.musicxml','score.mid':'audio/midi','score.pdf':'application/pdf'}[kind])
class Edit(BaseModel):
    revision:int
    part:str = Field(max_length=100)
    measure:int = Field(ge=0)
    entries:list[dict] = Field(max_length=500)
class Transpose(BaseModel):
    revision:int
    semitones:int = Field(ge=-24,le=24)
def mutation(pid,revision,transform):
    p=project(pid)
    if p['revision']!=revision:raise HTTPException(409,'This score has changed. Reopen it before editing.')
    if store.get_job(p['current_job'])['status'] in ('queued','running'):raise HTTPException(409,'Wait for conversion to finish before editing.')
    original=output(pid);edited=store.ROOT/pid/('edit-'+uuid.uuid4().hex);edited.mkdir()
    try:
        root=transform(scorexml.load(original/'score.musicxml'));root.set('version','4.0');report=scorexml.validate(root,p['options'].get('lyrics',True));scorexml.artifacts(root,edited)
        # Compare revision again inside write transaction; every edit keeps a history folder.
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current=db.execute('SELECT revision FROM projects WHERE id=?',(pid,)).fetchone()[0]
            if current!=revision:raise ValueError('Concurrent edit detected. Reopen the score.')
            relative=str(edited.relative_to(store.ROOT))
            db.execute('UPDATE projects SET revision=revision+1,updated=?,active_output=? WHERE id=?',(time.time(),relative,pid))
            db.execute('INSERT INTO revisions VALUES(?,?,?,?,?)',(pid,revision+1,relative,time.time(),json.dumps(report)))
            db.execute('UPDATE jobs SET report=? WHERE id=?',(json.dumps(report),p['current_job']))
    except Exception as e:
        shutil.rmtree(edited,ignore_errors=True);raise HTTPException(422,str(e))
    return dict(project(pid),job=store.get_job(p['current_job']))
@app.post('/projects/{pid}/lyrics')
def lyrics(pid,edit:Edit):return mutation(pid,edit.revision,lambda root:scorexml.edit_lyrics(root,edit.part,edit.measure,edit.entries))
@app.post('/projects/{pid}/transpose')
def transpose(pid,edit:Transpose):return mutation(pid,edit.revision,lambda root:scorexml.transpose(root,edit.semitones))

@app.get('/projects/{pid}/history')
def history(pid):
    project(pid)
    with store.connect() as db:
        return [dict(r) for r in db.execute('SELECT revision,created,report FROM revisions WHERE project_id=? ORDER BY revision DESC',(pid,)).fetchall()]
@app.get('/projects/{pid}/history/{revision}')
def historical_xml(pid,revision:int):
    project(pid)
    with store.connect() as db:
        row=db.execute('SELECT output_path FROM revisions WHERE project_id=? AND revision=?',(pid,revision)).fetchone()
    if not row:raise HTTPException(404,'Revision not found')
    return FileResponse(store.ROOT/row[0]/'score.musicxml',filename=f'score-revision-{revision}.musicxml',media_type='application/vnd.recordare.musicxml+xml')
