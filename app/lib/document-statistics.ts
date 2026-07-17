export type DocumentStatistics = {
  lines: number;
  words: number;
  characters: number;
};

const CJK_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const LATIN_WORD =
  /[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*(?:['’-][A-Za-z0-9]+)*/g;

export function calculateDocumentStatistics(
  content: string,
): DocumentStatistics {
  if (content.length === 0) {
    return { lines: 0, words: 0, characters: 0 };
  }

  const cjkCount = content.match(CJK_CHARACTER)?.length ?? 0;
  const latinWordCount = content.match(LATIN_WORD)?.length ?? 0;
  const lineBreakCount = content.match(/\r\n|\r|\n/g)?.length ?? 0;
  const endsWithLineBreak = /(?:\r\n|\r|\n)$/u.test(content);

  return {
    lines: lineBreakCount + (endsWithLineBreak ? 0 : 1),
    words: cjkCount + latinWordCount,
    characters: content.length,
  };
}
