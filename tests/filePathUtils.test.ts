import { describe, expect, it } from 'vitest';
import { extractVideoPathFromText } from '../src/renderer/utils/filePath';

describe('ファイルパス系ユーティリティ', () => {
  it('動画拡張子付きの素のパスをそのまま返す', () => {
    expect(extractVideoPathFromText('/Users/山田/家族動画.MP4')).toBe('/Users/山田/家族動画.MP4');
  });

  it('空白を含む file URL をデコードする', () => {
    const result = extractVideoPathFromText('file:///Users/山田/夏休み%20Vlog.mov');
    expect(result).toBe('/Users/山田/夏休み Vlog.mov');
  });

  it('Windows 形式の file URL に対応する', () => {
    const result = extractVideoPathFromText('file:///C:/Projects/ライブ映像.mkv');
    expect(result).toBe('C:/Projects/ライブ映像.mkv');
  });

  it('動画拡張子が無い文字列は棄却する', () => {
    expect(extractVideoPathFromText('/tmp/readme.txt')).toBeNull();
    expect(extractVideoPathFromText('')).toBeNull();
  });
});
