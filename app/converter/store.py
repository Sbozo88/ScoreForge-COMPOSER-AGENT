"""Single-host durable queue. SQLite and versioned artifacts share a persistent volume."""
import json, os, sqlite3, time, uuid
from pathlib import Path
ROOT = Path(os.environ.get('SCORE_DATA', '/data')).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
def connect():
    db = sqlite3.connect(ROOT / 'scores.sqlite', timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    return db
def init():
    with connect() as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
          pages INTEGER NOT NULL, options TEXT NOT NULL, current_job TEXT, revision INTEGER DEFAULT 0, active_output TEXT);
          CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL,
          stage TEXT NOT NULL, progress INTEGER DEFAULT 0, detail TEXT DEFAULT '', created REAL NOT NULL,
          options TEXT NOT NULL, report TEXT DEFAULT '{}');
          CREATE TABLE IF NOT EXISTS revisions (
          project_id TEXT NOT NULL, revision INTEGER NOT NULL, output_path TEXT NOT NULL,
          created REAL NOT NULL, report TEXT NOT NULL, PRIMARY KEY(project_id,revision));
          CREATE INDEX IF NOT EXISTS queue_order ON jobs(status,created);''')
        if 'active_output' not in [r[1] for r in db.execute('PRAGMA table_info(projects)')]:
            db.execute('ALTER TABLE projects ADD COLUMN active_output TEXT')
        # Single worker process; recover jobs abandoned by process termination.
        db.execute("UPDATE jobs SET status='queued',stage='queued',progress=0 WHERE status='running'")
def record(row):
    if row is None: return None
    result=dict(row)
    for key in ('options','report'):
        if key in result: result[key]=json.loads(result[key])
    return result
def get_project(pid):
    with connect() as db: return record(db.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone())
def get_job(jid):
    with connect() as db: return record(db.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
def projects():
    with connect() as db: rows=db.execute('SELECT * FROM projects ORDER BY updated DESC').fetchall()
    return [dict(record(row), job=get_job(row['current_job'])) for row in rows]
def enqueue(pid, options):
    jid=uuid.uuid4().hex
    with connect() as db:
        if db.execute("SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running')",(pid,)).fetchone():
            raise ValueError('A conversion is already active for this project.')
        db.execute('INSERT INTO jobs(id,project_id,status,stage,created,options) VALUES(?,?,?,?,?,?)',
          (jid,pid,'queued','queued',time.time(),json.dumps(options)))
        db.execute('UPDATE projects SET current_job=?,options=?,updated=? WHERE id=?',
          (jid,json.dumps(options),time.time(),pid))
    return jid
def claim():
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        if row: db.execute("UPDATE jobs SET status='running' WHERE id=?",(row['id'],))
        return record(row)
def update(jid, stage, progress, detail='', status='running', report=None):
    with connect() as db:
        db.execute('UPDATE jobs SET stage=?,progress=?,detail=?,status=?,report=COALESCE(?,report) WHERE id=?',
          (stage,progress,detail,status,json.dumps(report) if report is not None else None,jid))
        db.execute('UPDATE projects SET updated=? WHERE current_job=?',(time.time(),jid))
