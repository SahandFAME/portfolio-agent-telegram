import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('ai_handoff',ROOT/'scripts/build_ai_handoff.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class HandoffTests(unittest.TestCase):
    def test_package_hashes_offline_clone_and_untracked_secret_exclusion(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'fixture';root.mkdir()
            subprocess.run(['git','init',str(root)],check=True,capture_output=True)
            for name in module.DOCS+['scripts/asset-tables.json']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text('{}' if name.endswith('.json') else '# Synthetic project document\n')
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            subprocess.run(['git','-C',str(root),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Synthetic initial state'],check=True,capture_output=True)
            (root/'.env').write_text('SECRET=synthetic-private-value')
            previous=module.ROOT
            try:
                module.ROOT=root
                result=module.build(Path(temp)/'out')
            finally:module.ROOT=previous
            with zipfile.ZipFile(Path(temp)/'out/Portfolio-Agent-Handoff.zip') as z:
                self.assertIsNone(z.testzip());self.assertNotIn('source/.env',z.namelist())
                z.extractall(Path(temp)/'restore')
            restored=Path(temp)/'restore'
            subprocess.run(['python3',str(restored/'VERIFY_PACKAGE.py')],check=True,capture_output=True)
            subprocess.run(['git','clone',str(restored/'repository.bundle'),str(Path(temp)/'cloned')],check=True,capture_output=True)
            actual=subprocess.check_output(['git','-C',str(Path(temp)/'cloned'),'rev-parse','HEAD']).decode().strip()
            self.assertEqual(actual,result['source_commit'])
            manifest=json.loads((restored/'MANIFEST.json').read_text())
            self.assertFalse(manifest['includes_runtime_credentials']);self.assertFalse(manifest['includes_live_private_state'])
            (restored/'START_HERE.txt').write_text('changed')
            self.assertNotEqual(subprocess.run(['python3',str(restored/'VERIFY_PACKAGE.py')],capture_output=True).returncode,0)

    def test_output_inside_repo_rejected(self):
        with self.assertRaisesRegex(ValueError,'outside_repository'):
            module.build(module.ROOT/'handoff')
