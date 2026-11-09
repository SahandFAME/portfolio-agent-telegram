"""Build an offline, model-independent handoff from committed files only.

No network calls, environment exports, source-workbook reads or Blob access.
Output is private because existing tracked financial documentation is included.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DOCS = ['docs/AI_HANDOFF.md', 'docs/FEATURES.md', 'AGENTS.md', 'docs/CODEX_RECOVERY.md',
        'docs/CODEX_HANDOFF.md', 'docs/LATEST_ALLOCATION.md', 'docs/BOT_MENU.md',
        'docs/ADMIN_DASHBOARD.md', 'docs/ECOCOACH_PRICING.md',
        'docs/ONEDRIVE_VERIFICATION.md', 'docs/GOLD_HISTORY.md']
START = '''Resume my existing Portfolio Agent; do not rebuild it. Read
Portfolio-Agent-Complete-Handoff.md, starting with the current AI_HANDOFF brief,
and inspect the supplied source or latest main of
SahandFAME/portfolio-agent-telegram. Older appended documents contain superseded
requirements. Use current owner instructions and verify current code.
I authorize routine tested maintenance through PR, CI and deployment under the
documented safeguards. Reuse my existing services. Never modify Trading Journal,
expose credentials/private records, send live Telegram test messages without my
instruction, or retire existing synchronization without migration approval.
First audit knowledge, private-state dependencies and actual access. Tell me only
concrete missing permissions or decisions, and continue authorized independent work.
Keep durable decisions documented for future maintainers.
'''
VERIFY = '''import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent
manifest=json.loads((root/'MANIFEST.json').read_text())
for name,digest in manifest['sha256'].items():
    path=root/name
    assert path.resolve().is_relative_to(root), 'Unsafe manifest path'
    assert hashlib.sha256(path.read_bytes()).hexdigest()==digest, 'Changed file: '+name
print('All packaged files match the manifest; source commit: '+manifest['source_commit'])
'''


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def build(output, ref='HEAD', records=None):
    output = Path(output).resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError('output_must_be_outside_repository')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    commit = git('rev-parse', '--verify', ref+'^{commit}').decode().strip()
    tracked = git('ls-tree', '-r', '--name-only', '-z', commit).decode().split('\0')
    files = {}
    for name in filter(None, tracked):
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('unsafe_tracked_path')
        if (path.name.startswith('.env') and path.name!='.env.example') or path.suffix.lower() in ('.xlsm', '.xlsx'):
            raise ValueError('sensitive_tracked_file_requires_review')
        data = git('show', commit+':'+name)
        if path.name=='.env.example' and any(line.strip() and not line.lstrip().startswith('#') and ('=' not in line or line.split('=',1)[1].strip()) for line in data.decode().splitlines()):
            raise ValueError('nonempty_environment_template_requires_review')
        files['source/'+name] = data
    assembled = ['# Portfolio Agent — complete portable handoff\n\n'
                 '**PRIVATE COPY: contains historical financial documentation.**\n\n'
                 'Source commit: `'+commit+'`. This is a knowledge/source snapshot, '
                 'not credentials, private Blob state or a verbatim chat export.\n\n'
                 'Read the first current brief before the historical appendices. '
                 'The source archive and Git bundle provide implementation details.\n']
    for name in DOCS:
        assembled.append('\n\n---\n\n<!-- BEGIN '+name+' -->\n\n'+
                         files['source/'+name].decode()+'\n\n<!-- END '+name+' -->')
    assembled.append('\n\n---\n\n# Exact quantity table mapping\n\n```json\n'+
                     files['source/scripts/asset-tables.json'].decode()+'\n```\n')
    log = git('log', '--reverse', '--format=%h %s', commit).decode()
    assembled.append('\n\n# Implementation chronology (Git commits)\n\n```text\n'+log+'\n```\n')
    if records:
        records = Path(records)
        for name in ['issue-1.json', 'pull-requests.json']:
            data = json.loads((records/name).read_text())
            files['records/'+name] = json.dumps(data, ensure_ascii=False, indent=2).encode()
        issue = json.loads(files['records/issue-1.json'])
        assembled.append('\n\n# Original operational takeover issue #1\n\n'+issue['body'])
        prs = json.loads(files['records/pull-requests.json'])
        assembled.append('\n\n# GitHub pull request ledger\n\nDescriptions and source changes are in records/ and the Git history.\n')
        for pr in sorted(prs, key=lambda p:p['number']):
            assembled.append('\n- #'+str(pr['number'])+' — '+pr['title']+
                             (' (merged)' if pr.get('merged_at') else ' ('+pr['state']+')'))
    files['Portfolio-Agent-Complete-Handoff.md'] = '\n'.join(assembled).encode()
    files['START_HERE.txt'] = START.encode()
    files['VERIFY_PACKAGE.py'] = VERIFY.encode()
    with tempfile.TemporaryDirectory() as temp:
        # Only the requested reachable history, not arbitrary local ops branches.
        repo = Path(temp)/'repo'
        subprocess.run(['git','init','--bare',str(repo)],check=True,capture_output=True)
        subprocess.run(['git','-C',str(repo),'fetch',str(ROOT),commit+':refs/heads/main'],check=True,capture_output=True)
        subprocess.run(['git','-C',str(repo),'symbolic-ref','HEAD','refs/heads/main'],check=True,capture_output=True)
        subprocess.run(['git','-C',str(repo),'bundle','create',str(Path(temp)/'repository.bundle'),'--all'],check=True,capture_output=True)
        files['repository.bundle'] = (Path(temp)/'repository.bundle').read_bytes()
    files['README.txt'] = ('''PRIVATE OFFLINE PROJECT HANDOFF
1. Read START_HERE.txt and attach Portfolio-Agent-Complete-Handoff.md to your new AI.
2. Run: python VERIFY_PACKAGE.py
3. source/ contains the recorded implementation. Prefer latest upstream main when available.
4. Offline Git recovery: git clone repository.bundle portfolio-agent-telegram
5. Credentials, live private state, Trading Journal and chat export are NOT included.
6. Restore secure account access separately using the recovery guide. Keep existing private storage.
7. The manifest checks accidental corruption; it is not an independent digital signature.
Do not upload this archive to public issues/releases. Relative links in the assembled
Markdown refer to the source repository; the complete referenced documents are appended.
''').encode()
    manifest = {'format':'portfolio-agent-ai-handoff-v1', 'source_commit':commit,
                'includes_live_private_state':False, 'includes_runtime_credentials':False,
                'sha256':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}}
    files['MANIFEST.json'] = json.dumps(manifest, indent=2).encode()
    archive = output/'Portfolio-Agent-Handoff.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name,data in sorted(files.items()):
            z.writestr(name,data)
    for name in ['Portfolio-Agent-Complete-Handoff.md','START_HERE.txt','MANIFEST.json']:
        (output/name).write_bytes(files[name])
    (output/'Portfolio-Agent-Handoff.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
    return {'source_commit':commit,'packaged_files':len(files),'archive_bytes':archive.stat().st_size}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--records-dir', help='Optional private directory with issue-1.json and pull-requests.json snapshots')
    args=parser.parse_args()
    print(json.dumps(build(args.output_dir,args.ref,args.records_dir)))
