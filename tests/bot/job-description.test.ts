import { describe, expect, it } from 'vitest';

import {
  JobDescriptionError,
  classifyJobDescriptionInput,
  decodeHtmlEntities,
  htmlToText,
  isJobDescriptionUrl,
  resolveJobDescription,
  type JobDescriptionFetch,
  type JobDescriptionFetchResponse,
} from '../../src/bot/job-description';

function fakeResponse(
  body: string,
  init: {
    status?: number;
    ok?: boolean;
    contentType?: string | null;
  } = {},
): JobDescriptionFetchResponse {
  const status = init.status ?? 200;
  const contentType =
    init.contentType === undefined ? 'text/html' : init.contentType;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? contentType : null,
    },
    text: async () => body,
  };
}

describe('isJobDescriptionUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isJobDescriptionUrl('https://example.com/jobs/1')).toBe(true);
    expect(isJobDescriptionUrl('http://example.com/jobs/1?ref=mail')).toBe(true);
  });

  it('rejects non-http schemes and free text', () => {
    expect(isJobDescriptionUrl('ftp://example.com/jobs/1')).toBe(false);
    expect(isJobDescriptionUrl('example.com/jobs/1')).toBe(false);
    expect(isJobDescriptionUrl('Senior Engineer, Remote')).toBe(false);
    expect(isJobDescriptionUrl('https://')).toBe(false);
  });
});

describe('classifyJobDescriptionInput', () => {
  it('classifies pasted text', () => {
    expect(classifyJobDescriptionInput('  Senior Engineer\nRemote  ')).toEqual({
      kind: 'text',
      text: 'Senior Engineer\nRemote',
    });
  });

  it('classifies a bare URL', () => {
    expect(
      classifyJobDescriptionInput('  https://example.com/jobs/1  '),
    ).toEqual({ kind: 'url', url: 'https://example.com/jobs/1' });
  });

  it('treats text that merely contains a URL as pasted text', () => {
    const input = 'Apply here: https://example.com/jobs/1';
    expect(classifyJobDescriptionInput(input)).toEqual({
      kind: 'text',
      text: input,
    });
  });

  it('rejects empty input', () => {
    expect(() => classifyJobDescriptionInput('')).toThrow(JobDescriptionError);
    expect(() => classifyJobDescriptionInput('   \n  ')).toThrow(/empty/i);
  });
});

describe('htmlToText', () => {
  it('strips tags and keeps paragraph breaks', () => {
    expect(htmlToText('<p>Hello&nbsp;<b>world</b></p><p>Second</p>')).toBe(
      'Hello world\nSecond',
    );
  });

  it('drops script and style content', () => {
    expect(htmlToText('<div>Keep<script>var x = 1;</script>Drop</div>')).toBe(
      'Keep Drop',
    );
  });

  it('decodes entities', () => {
    expect(htmlToText('<p>R&amp;D &mdash; 100&#37;</p>')).toBe('R&D — 100%');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(
      decodeHtmlEntities('&amp;&lt;&gt;&quot;&#39;&#x41;&#66;&nbsp;'),
    ).toBe(`&<>"'AB `);
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeHtmlEntities('&unknown; &#xZZ;')).toBe('&unknown; &#xZZ;');
  });
});

describe('resolveJobDescription', () => {
  it('returns pasted text without fetching', async () => {
    const fetchImpl: JobDescriptionFetch = async () => {
      throw new Error('fetch should not be called for pasted text');
    };

    const result = await resolveJobDescription(
      '  Senior Engineer\nRemote  ',
      fetchImpl,
    );

    expect(result.source).toEqual({
      kind: 'text',
      text: 'Senior Engineer\nRemote',
    });
    expect(result.text).toBe('Senior Engineer\nRemote');
    expect(result.url).toBeUndefined();
  });

  it('fetches a URL and converts HTML to text', async () => {
    const calls: string[] = [];
    const fetchImpl: JobDescriptionFetch = async (url) => {
      calls.push(url);
      return fakeResponse(
        '<html><body><h1>Staff Engineer</h1><p>Build things.</p></body></html>',
      );
    };

    const result = await resolveJobDescription(
      'https://example.com/jobs/1',
      fetchImpl,
    );

    expect(calls).toEqual(['https://example.com/jobs/1']);
    expect(result.source).toEqual({
      kind: 'url',
      url: 'https://example.com/jobs/1',
    });
    expect(result.url).toBe('https://example.com/jobs/1');
    expect(result.text).toBe('Staff Engineer\nBuild things.');
  });

  it('keeps plain-text responses as-is', async () => {
    const fetchImpl: JobDescriptionFetch = async () =>
      fakeResponse('Senior Engineer\nRemote', { contentType: 'text/plain' });

    const result = await resolveJobDescription(
      'https://example.com/jd.txt',
      fetchImpl,
    );

    expect(result.text).toBe('Senior Engineer\nRemote');
  });

  it('sniffs HTML when the server sends no content type', async () => {
    const fetchImpl: JobDescriptionFetch = async () =>
      fakeResponse('<div>Role: Engineer</div>', { contentType: null });

    const result = await resolveJobDescription(
      'https://example.com/jd',
      fetchImpl,
    );

    expect(result.text).toBe('Role: Engineer');
  });

  it('rejects non-2xx responses', async () => {
    const fetchImpl: JobDescriptionFetch = async () =>
      fakeResponse('missing', {
        status: 404,
        ok: false,
        contentType: 'text/plain',
      });

    await expect(
      resolveJobDescription('https://example.com/missing', fetchImpl),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rejects empty bodies', async () => {
    const fetchImpl: JobDescriptionFetch = async () =>
      fakeResponse('   \n  ', { contentType: 'text/plain' });

    await expect(
      resolveJobDescription('https://example.com/empty', fetchImpl),
    ).rejects.toThrow(/empty/i);
  });

  it('wraps transport failures in a JobDescriptionError', async () => {
    const fetchImpl: JobDescriptionFetch = async () => {
      throw new Error('network down');
    };

    await expect(
      resolveJobDescription('https://example.com/jobs/1', fetchImpl),
    ).rejects.toBeInstanceOf(JobDescriptionError);
  });
});
