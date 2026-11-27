"""Worker regression tests: run with converter/.venv/bin/python tests/scorexml_test.py."""
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'converter'))
import scorexml as sx

local_schema = Path(__file__).resolve().parents[1] / 'converter/.local/musicxml/schema/musicxml.xsd'
if local_schema.is_file():
    os.environ.setdefault('MUSICXML_XSD', str(local_schema))


def score(body):
    return sx.E.fromstring(('''<score-partwise version="4.0"><part-list><score-part id="P1">
    <part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1">
    <attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>G</sign><line>2</line></clef></attributes>''' + body +
    '</measure></part></score-partwise>').encode(), sx.PARSER())


def note(extra='', duration=3):
    return f'<note><pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration><voice>1</voice><type>quarter</type>{extra}</note>'


class ExportTests(unittest.TestCase):
    def test_official_31_transform_keeps_music_and_removes_40_listening(self):
        root = score(note('<lyric number="1"><text>Lu</text></lyric><listen><assess type="yes"/></listen>',12))
        data = sx.dorico_export(root)
        converted = sx.E.fromstring(data, sx.PARSER())
        self.assertEqual(converted.get('version'), '3.1')
        self.assertEqual(root.get('version'), '4.0')
        self.assertIsNotNone(root.find('.//listen'))
        self.assertIsNone(converted.find('.//listen'))
        for tag in ('pitch', 'duration', 'voice', 'lyric'):
            self.assertEqual(sx.E.tostring(root.find('.//' + tag)), sx.E.tostring(converted.find('.//' + tag)))
        self.assertIn(b'DTD MusicXML 3.1 Partwise', data)

    def test_mxl_has_stored_first_mimetype_and_same_score(self):
        root = score(note(duration=12))
        with tempfile.TemporaryDirectory() as folder:
            sx.artifacts(root,folder)
            with zipfile.ZipFile(Path(folder) / 'score.mxl') as z:
                first=z.infolist()[0]
                self.assertEqual(first.filename,'mimetype')
                self.assertEqual(first.compress_type,zipfile.ZIP_STORED)
                self.assertEqual(z.read(first),b'application/vnd.recordare.musicxml')
                self.assertEqual(z.read('score.musicxml'),(Path(folder)/'score.musicxml').read_bytes())
            sx.validate(sx.load(Path(folder)/'score.mxl'))

    def test_negative_backup_blocks_invalid_export(self):
        with self.assertRaisesRegex(ValueError,'backup crosses bar boundary'):
            sx.validate(score(note()+'<backup><duration>6</duration></backup>'+note()))

    def test_forward_counts_towards_bar_length(self):
        report=sx.validate(score(note()+'<forward><duration>9</duration></forward>'))
        self.assertEqual(report['warnings'],[])

    def test_lyrics_inserted_before_performance_data(self):
        root=score(note('<play><other-play type="test">value</other-play></play>',12))
        sx.edit_lyrics(root,'P1',0,[{'note':0,'text':'Sing'}])
        sx.validate(root)
        self.assertEqual([x.tag for x in root.find('.//note')][-2:],['lyric','play'])

    def test_tuplets_and_multiple_voices_survive_compatibility_export(self):
        tuplet=note('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>quarter</normal-type></time-modification>',2)
        root=score(tuplet*3+note(duration=6)+'<backup><duration>12</duration></backup>'+note(duration=12).replace('<voice>1','<voice>2'))
        converted=sx.E.fromstring(sx.dorico_export(root),sx.PARSER())
        self.assertEqual(converted.xpath('//duration/text()'),root.xpath('//duration/text()'))
        self.assertEqual(converted.xpath('//voice/text()'),root.xpath('//voice/text()'))
        self.assertEqual(len(converted.findall('.//time-modification')),3)
        self.assertEqual(sx.validate(converted)['warnings'],[])


if __name__ == '__main__':
    unittest.main()
