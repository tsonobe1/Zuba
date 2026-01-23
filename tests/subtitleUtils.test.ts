import { describe, expect, it } from 'vitest';
import {
  buildSubtitleEntry,
  findActiveSubtitle,
  formatTime,
  normalizeRange,
  DEFAULT_SUBTITLE_POSITION
} from '../src/renderer/utils/subtitle';

describe('subtitle utilities (classical)', () => {
  it('formats seconds under a minute', () => {
    expect(formatTime(12.345)).toBe('12.35s');
  });

  it('formats seconds over a minute with padding', () => {
    expect(formatTime(125.1)).toBe('2:05.10s');
  });

  it('normalizes the start/end order', () => {
    const result = normalizeRange(8, 2);
    expect(result).toEqual({ start: 2, end: 8 });
  });

  it('builds an entry with generated id and trimmed text', () => {
    const entry = buildSubtitleEntry(
      {
        text: '  hello  ',
        start: 3,
        end: 5,
        styles: {
          fontColor: '#fff',
          backgroundColor: '#000',
          fontSize: 20,
          fontFamily: 'Arial'
        }
      },
      () => 'id-1'
    );
    expect(entry).toMatchObject({ id: 'id-1', text: 'hello', start: 3, end: 5, position: DEFAULT_SUBTITLE_POSITION });
  });

  it('finds the active subtitle range', () => {
    const active = findActiveSubtitle(
      [
        {
          id: 'a',
          text: 'one',
          start: 0,
          end: 1,
          styles: { fontColor: '#fff', backgroundColor: '#000', fontSize: 20, fontFamily: 'Arial' },
          position: { xPercent: 50, yPercent: 85 }
        },
        {
          id: 'b',
          text: 'two',
          start: 1,
          end: 2,
          styles: { fontColor: '#fff', backgroundColor: '#000', fontSize: 20, fontFamily: 'Arial' },
          position: { xPercent: 50, yPercent: 85 }
        }
      ],
      1.5
    );
    expect(active?.id).toBe('b');
  });
});
