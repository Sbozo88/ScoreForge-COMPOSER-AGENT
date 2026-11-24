/**
 * Pure MusicXML helpers for voice/beat positioning and syllable alignment review.
 * Works in both browser DOMParser and Node tests (with any DOM-like Document).
 */

const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Compute per-note beat offsets, voices, and chord relationships for a MusicXML measure.
 */
export function analyzeMeasureNotes(measure, initialDivisions = 1) {
  let divisions = Math.max(1, Number(initialDivisions) || 1);
  let cursor = 0;
  let lastStart = 0;
  let noteIndex = 0;
  const rows = [];

  for (const item of Array.from(measure.children || [])) {
    const tag = item.tagName;
    if (tag === 'attributes') {
      const divText = directChildText(item, 'divisions');
      if (divText) divisions = Math.max(1, Number(divText) || divisions);
      continue;
    }
    const durVal = Number(directChildText(item, 'duration') || 0) / divisions;
    if (tag === 'backup') {
      cursor = Math.max(0, cursor - durVal);
      continue;
    }
    if (tag === 'forward') {
      cursor += durVal;
      continue;
    }
    if (tag !== 'note') continue;

    const isRest = Boolean(directChild(item, 'rest'));
    const isChord = Boolean(directChild(item, 'chord'));
    const isGrace = Boolean(directChild(item, 'grace'));
    const startBeat = isChord ? lastStart : cursor;
    const voice = directChildText(item, 'voice') || '1';
    const staff = directChildText(item, 'staff') || '1';

    let pitchLabel = isRest ? 'Rest' : 'Note';
    const pitch = directChild(item, 'pitch');
    if (pitch) {
      const step = directChildText(pitch, 'step') || '';
      const octave = directChildText(pitch, 'octave') || '';
      const alter = Number(directChildText(pitch, 'alter') || 0);
      const accidental = alter === 1 ? '♯' : alter === -1 ? '♭' : alter === 2 ? '𝄪' : alter === -2 ? '𝄫' : '';
      pitchLabel = `${step}${accidental}${octave}`;
    }

    const lyrics = Array.from(item.children || [])
      .filter((c) => c.tagName === 'lyric')
      .map((l) => ({
        verse: l.getAttribute('number') || '1',
        syllabic: directChildText(l, 'syllabic') || 'single',
        text: directChildText(l, 'text') || '',
        extend: Boolean(directChild(l, 'extend'))
      }));

    rows.push({
      noteIndex,
      beat: Math.round((startBeat + 1) * 1000) / 1000,
      beatOffset: Math.round(startBeat * 1000) / 1000,
      duration: Math.round(durVal * 1000) / 1000,
      voice,
      staff,
      isRest,
      isChord,
      isGrace,
      pitchLabel,
      lyrics
    });

    if (!isChord && !isGrace) {
      lastStart = cursor;
      cursor += durVal;
    }
    noteIndex++;
  }

  return { divisions, rows };
}

/**
 * Audit a MusicXML score-partwise document for notation & syllable alignment issues.
 */
export function auditNotation(xml) {
  const parts = Array.from(xml.querySelectorAll('score-partwise > part'));
  const partNames = new Map(
    Array.from(xml.querySelectorAll('score-part')).map((p) => [
      p.getAttribute('id'),
      p.querySelector('part-name')?.textContent?.trim() || p.getAttribute('id')
    ])
  );

  const issues = [];
  let totalSyllables = 0;
  let multiVoiceMeasures = 0;

  for (const part of parts) {
    const partId = part.getAttribute('id') || '';
    const partName = partNames.get(partId) || partId;
    let divisions = 1;
    const openHyphens = new Map(); // verse -> { partName, measureLabel, text }

    const measures = Array.from(part.children || []).filter((c) => c.tagName === 'measure');
    let partHasAnyLyrics = false;

    for (let mIdx = 0; mIdx < measures.length; mIdx++) {
      const measure = measures[mIdx];
      const measureLabel = measure.getAttribute('number') || String(mIdx + 1);
      const analyzed = analyzeMeasureNotes(measure, divisions);
      divisions = analyzed.divisions;

      const voicesWithLyrics = new Set();
      const beatVoiceSyllables = new Map();

      for (const row of analyzed.rows) {
        for (const lyr of row.lyrics) {
          partHasAnyLyrics = true;
          totalSyllables++;
          voicesWithLyrics.add(row.voice);

          if (row.isRest) {
            issues.push({
              severity: 'error',
              partId,
              partName,
              measureIndex: mIdx,
              measureLabel,
              message: `${partName}, bar ${measureLabel}: syllable "${lyr.text}" attached to a rest.`
            });
          } else if (row.isChord) {
            issues.push({
              severity: 'warning',
              partId,
              partName,
              measureIndex: mIdx,
              measureLabel,
              message: `${partName}, bar ${measureLabel} (beat ${row.beat}): syllable "${lyr.text}" attached to a chord tone; align to primary onset note.`
            });
          }

          const bvKey = `${row.voice}:${row.beatOffset}:${lyr.verse}`;
          beatVoiceSyllables.set(bvKey, (beatVoiceSyllables.get(bvKey) || 0) + 1);

          const prev = openHyphens.get(lyr.verse);
          if (lyr.syllabic === 'begin') {
            if (prev) {
              issues.push({
                severity: 'warning',
                partId,
                partName,
                measureIndex: mIdx,
                measureLabel,
                message: `${partName}, bar ${measureLabel} (v.${lyr.verse}): "${prev.text}-" never closed before "${lyr.text}-".`
              });
            }
            openHyphens.set(lyr.verse, { partName, measureLabel, text: lyr.text });
          } else if (lyr.syllabic === 'middle') {
            if (!prev) {
              issues.push({
                severity: 'warning',
                partId,
                partName,
                measureIndex: mIdx,
                measureLabel,
                message: `${partName}, bar ${measureLabel} (v.${lyr.verse}): middle syllable "-${lyr.text}-" without a preceding "begin".`
              });
            }
            openHyphens.set(lyr.verse, { partName, measureLabel, text: lyr.text });
          } else if (lyr.syllabic === 'end') {
            if (!prev) {
              issues.push({
                severity: 'warning',
                partId,
                partName,
                measureIndex: mIdx,
                measureLabel,
                message: `${partName}, bar ${measureLabel} (v.${lyr.verse}): ending syllable "-${lyr.text}" without an open hyphen.`
              });
            }
            openHyphens.delete(lyr.verse);
          } else if (prev) {
            issues.push({
              severity: 'warning',
              partId,
              partName,
              measureIndex: mIdx,
              measureLabel,
              message: `${partName}, bar ${measureLabel} (v.${lyr.verse}): "${prev.text}-" hyphenation interrupted by standalone "${lyr.text}".`
            });
            openHyphens.delete(lyr.verse);
          }
        }
      }

      const distinctVoices = new Set(analyzed.rows.filter((r) => !r.isRest).map((r) => r.voice));
      if (distinctVoices.size > 1) multiVoiceMeasures++;

      for (const [bvKey, count] of beatVoiceSyllables) {
        if (count > 1) {
          const [voice, , verse] = bvKey.split(':');
          issues.push({
            severity: 'warning',
            partId,
            partName,
            measureIndex: mIdx,
            measureLabel,
            message: `${partName}, bar ${measureLabel}: ${count} stacked syllables in voice ${voice}, verse ${verse} at the same beat.`
          });
        }
      }

      if (voicesWithLyrics.size > 1) {
        issues.push({
          severity: 'info',
          partId,
          partName,
          measureIndex: mIdx,
          measureLabel,
          message: `${partName}, bar ${measureLabel}: dense multi-voice lyrics (${Array.from(voicesWithLyrics).join(', ')}); verify vertical clearance.`
        });
      }
    }

    if (partHasAnyLyrics) {
      for (const [verse, open] of openHyphens) {
        issues.push({
          severity: 'warning',
          partId,
          partName,
          measureIndex: Math.max(0, measures.length - 1),
          measureLabel: open.measureLabel,
          message: `${open.partName}, bar ${open.measureLabel} (v.${verse}): trailing unclosed hyphen on "${open.text}-".`
        });
      }
    }
  }

  return {
    parts: parts.length,
    totalSyllables,
    multiVoiceMeasures,
    issues
  };
}

function directChild(el, tagName) {
  for (const child of Array.from(el.children || [])) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

function directChildText(el, tagName) {
  const child = directChild(el, tagName);
  return child ? (child.textContent || '').trim() : '';
}

export { STEP_TO_SEMITONE };
