import { describe, expect, it } from 'vitest';
import {
  buildSubtitleEntry,
  findActiveSubtitle,
  formatTime,
  normalizeRange,
  DEFAULT_SUBTITLE_POSITION
} from '../src/renderer/utils/subtitle';

describe('字幕ユーティリティ（古典学派）', () => {
  it('1 分未満の秒数をフォーマットする', () => {
    expect(formatTime(12.345)).toBe('12.35s');
  });

  it('1 分以上の秒数をゼロ埋めでフォーマットする', () => {
    expect(formatTime(125.1)).toBe('2:05.10s');
  });

  it('開始と終了の並び順を正規化する', () => {
    const result = normalizeRange(8, 2);
    expect(result).toEqual({ start: 2, end: 8 });
  });

  it('生成された ID とトリム済みテキストでエントリを組み立てる', () => {
    const entry = buildSubtitleEntry(
      {
        text: '  こんにちは  ',
        start: 3,
        end: 5,
        styles: {
          fontColor: '#fff',
          backgroundColor: '#000',
          fontSize: 20,
          fontFamily: '源ノ角ゴシック'
        }
      },
      () => 'id-1'
    );
    expect(entry).toMatchObject({ id: 'id-1', text: 'こんにちは', start: 3, end: 5, position: DEFAULT_SUBTITLE_POSITION });
  });

  it('現在時刻に該当する字幕レンジを返す', () => {
    const active = findActiveSubtitle(
      [
        {
          id: 'a',
          text: '一番目',
          start: 0,
          end: 1,
          styles: { fontColor: '#fff', backgroundColor: '#000', fontSize: 20, fontFamily: '源ノ角ゴシック' },
          position: { xPercent: 50, yPercent: 85 }
        },
        {
          id: 'b',
          text: '二番目',
          start: 1,
          end: 2,
          styles: { fontColor: '#fff', backgroundColor: '#000', fontSize: 20, fontFamily: '源ノ角ゴシック' },
          position: { xPercent: 50, yPercent: 85 }
        }
      ],
      1.5
    );
    expect(active?.id).toBe('b');
  });
});
