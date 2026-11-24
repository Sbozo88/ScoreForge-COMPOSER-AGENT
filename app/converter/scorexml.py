"""Validate, edit, and export real MusicXML without fabricating recognized notes."""
import copy, json, os, zipfile
from fractions import Fraction
from pathlib import Path
from lxml import etree as E
from music21 import converter, interval
PARSER=lambda:E.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, remove_blank_text=False)
def load(path):
    if str(path).endswith('.mxl'):
        with zipfile.ZipFile(path) as z:
            container=E.fromstring(z.read('META-INF/container.xml'),PARSER())
            names=container.xpath('//*[local-name()="rootfile"]/@full-path')
            if not names or names[0] not in z.namelist(): raise ValueError('Invalid MXL container.')
            if z.getinfo(names[0]).file_size>100*1024*1024: raise ValueError('Score XML too large.')
            return E.fromstring(z.read(names[0]),PARSER())
    return E.parse(str(path),PARSER()).getroot()
def save(root, path):
    root.set('version','4.0')
    Path(path).write_bytes(E.tostring(root,xml_declaration=True,encoding='UTF-8'))
def validate(root, lyric_expected=False):
    if root.tag!='score-partwise': raise ValueError('Only score-partwise MusicXML is supported.')
    schema=Path(os.environ.get('MUSICXML_XSD','/opt/musicxml/schema/musicxml.xsd'))
    if not schema.is_file(): raise ValueError('MusicXML 4.0 schema is missing; validation cannot complete.')
    E.XMLSchema(E.parse(str(schema),PARSER())).assertValid(root)
    warnings=[]; parts=root.findall('part'); counts=[len(p.findall('measure')) for p in parts]
    if not counts: raise ValueError('No recognized score parts.')
    if len(set(counts))>1: warnings.append('Part measure counts differ; inspect system and part continuity.')
    for part in parts:
        divisions=1; beats=4; beat_type=4
        for measure in part.findall('measure'):
            attrs=measure.find('attributes')
            if attrs is not None:
                divisions=int(attrs.findtext('divisions',str(divisions)))
                time=attrs.find('time')
                if time is not None and time.find('beats') is not None:
                    beats=sum(int(x) for x in time.findtext('beats').split('+'));beat_type=int(time.findtext('beat-type','4'))
            if divisions<1: raise ValueError('Invalid duration divisions.')
            cursor=Fraction(0); high=Fraction(0); prev=Fraction(0)
            for child in measure:
                duration=Fraction(child.findtext('duration','0'))/divisions
                if child.tag=='backup': cursor-=duration
                elif child.tag=='forward': cursor+=duration
                elif child.tag=='note' and child.find('grace') is None:
                    if child.find('chord') is None: prev=cursor;cursor+=duration
                    high=max(high,prev+duration)
                if cursor<0: warnings.append(f"{part.get('id')}, bar {measure.get('number')}: voice backup crosses bar boundary.")
            expected=Fraction(beats*4,beat_type)
            if high!=expected and measure.get('implicit')!='yes' and len(warnings)<200:
                warnings.append(f"{part.get('id')}, bar {measure.get('number')}: {high} quarter beats; expected {expected}. Review pickup, tuplet or voice timing.")
    if lyric_expected and not root.findall('.//lyric'): warnings.append('No aligned lyrics were recognized. Compare the PDF and add lyrics manually.')
    # Independent notation parser catches structures beyond well-formed XML.
    converter.parseData(E.tostring(root).decode('utf-8'),format='musicxml')
    return {'schema':'MusicXML 4.0','valid_xml':True,'parts':len(parts),'measures':counts,'warnings':warnings,'lyric_syllables':len(root.findall('.//lyric'))}
def artifacts(root, directory):
    directory=Path(directory); directory.mkdir(parents=True,exist_ok=True)
    xml=directory/'score.musicxml';save(root,xml)
    with zipfile.ZipFile(directory/'score.mxl','w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('mimetype','application/vnd.recordare.musicxml')
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>')
        z.write(xml,'score.musicxml')
    converter.parse(str(xml)).write('midi',fp=str(directory/'score.mid'))
def edit_lyrics(root, part_id, measure_index, entries):
    part=next((p for p in root.findall('part') if p.get('id')==part_id),None)
    if part is None: raise ValueError('Unknown part.')
    measures=part.findall('measure')
    if not 0<=measure_index<len(measures): raise ValueError('Unknown measure.')
    notes=measures[measure_index].findall('note')
    for entry in entries:
        index=int(entry['note']); verse=str(entry.get('verse','1'))
        if not 0<=index<len(notes) or notes[index].find('rest') is not None: raise ValueError('Lyrics require a pitched note.')
        note=notes[index]
        text=entry.get('text','')
        if not isinstance(text,str) or len(text)>500: raise ValueError('Lyric syllable too long.')
        if note.find('chord') is not None and (text or entry.get('extend')):
            raise ValueError('Attach lyrics to the primary note in a chord, not chord tones.')
        for lyric in list(note.findall('lyric')):
            if lyric.get('number','1')==verse: note.remove(lyric)
        if not text and not entry.get('extend'): continue
        lyric=E.SubElement(note,'lyric',number=verse)
        syllabic=entry.get('syllabic','single')
        if syllabic not in ('single','begin','middle','end'): raise ValueError('Invalid hyphenation.')
        if text:
            E.SubElement(lyric,'syllabic').text=syllabic
            E.SubElement(lyric,'text').text=text
        if entry.get('extend'): E.SubElement(lyric,'extend',type='start')
    return root
def transpose(root, semitones):
    if not -24<=semitones<=24: raise ValueError('Transpose must be within two octaves.')
    # music21 preserves instrumental transposition and computes enharmonic spelling.
    score=converter.parseData(E.tostring(root).decode('utf-8'),format='musicxml')
    score.transpose(interval.ChromaticInterval(semitones),inPlace=True)
    from music21.musicxml.m21ToXml import GeneralObjectExporter
    return E.fromstring(GeneralObjectExporter(score).parse(),PARSER())
