const videoExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.webm'];

const looksLikeVideoPath = (input: string) => {
  const lower = input.toLowerCase();
  return videoExtensions.some((ext) => lower.endsWith(ext));
};

const stripWrappingQuotes = (value: string) => value.replace(/^["']+|["']+$/g, '');

const decodeFileUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') {
      return null;
    }
    let pathname = decodeURIComponent(url.pathname || '');
    if (/^\/[a-zA-Z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname || null;
  } catch {
    return null;
  }
};

export const extractVideoPathFromText = (input: string): string | null => {
  if (!input) return null;
  const trimmed = stripWrappingQuotes(input.trim());
  if (!trimmed) return null;
  if (!looksLikeVideoPath(trimmed)) {
    return null;
  }
  if (/^file:\/\//i.test(trimmed)) {
    return decodeFileUrl(trimmed);
  }
  return trimmed;
};
