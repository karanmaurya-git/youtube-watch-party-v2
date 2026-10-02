import { describe, it, expect } from 'vitest';
import { parseVideoId } from '../src/utils/youtube.js';

describe('parseVideoId', () => {
  const id = 'dQw4w9WgXcQ';
  it.each([
    [`https://www.youtube.com/watch?v=${id}`],
    [`https://www.youtube.com/watch?v=${id}&t=42s&list=abc`],
    [`https://youtu.be/${id}`],
    [`https://youtu.be/${id}?si=xyz`],
    [`https://www.youtube.com/embed/${id}`],
    [`https://www.youtube.com/shorts/${id}`],
    [`https://m.youtube.com/watch?v=${id}`],
    [`youtube.com/watch?v=${id}`],
    [id],
  ])('extracts the id from %s', (input) => {
    expect(parseVideoId(input)).toBe(id);
  });

  it.each([[''], ['hello world'], ['https://example.com/watch?v=dQw4w9WgXcQ'], ['https://youtu.be/short'], [null], [42]])(
    'rejects %s',
    (input) => {
      expect(parseVideoId(input)).toBeNull();
    }
  );
});
