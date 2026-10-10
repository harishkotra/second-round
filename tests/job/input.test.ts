import { describe, expect, it } from 'vitest'
import { htmlToText, isJobUrl, loadJobDescription, parseJobInput } from '../../src/job/input.js'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function fetchReturning(body: string, status = 200): typeof fetch {
  const response: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  }
  return (() => Promise.resolve(response)) as unknown as typeof fetch
}

describe('isJobUrl', () => {
  it('accepts a bare http or https URL', () => {
    expect(isJobUrl('https://example.com/jobs/1')).toBe(true)
    expect(isJobUrl('http://example.com/jobs/1')).toBe(true)
  })

  it('rejects pasted text that merely mentions a link', () => {
    expect(isJobUrl('Apply at https://example.com/jobs/1 today')).toBe(false)
  })

  it('rejects schemes that are not http or https', () => {
    expect(isJobUrl('ftp://example.com/jobs/1')).toBe(false)
    expect(isJobUrl('mailto:jobs@example.com')).toBe(false)
  })
})

describe('parseJobInput', () => {
  it('reads a bare URL as a url source', () => {
    expect(parseJobInput('  https://example.com/jobs/1  ')).toEqual({
      kind: 'url',
      url: 'https://example.com/jobs/1',
    })
  })

  it('reads pasted text as a text source, trimmed', () => {
    expect(parseJobInput('\n  Senior Engineer\n  Build things  \n')).toEqual({
      kind: 'text',
      text: 'Senior Engineer\n  Build things',
    })
  })

  it('refuses empty input rather than guessing', () => {
    expect(() => parseJobInput('   ')).toThrow(/empty/)
  })
})

describe('htmlToText', () => {
  it('drops tags, scripts and styles, and collapses whitespace', () => {
    const html =
      '<html><head><style>p{color:red}</style></head>' +
      '<body><h1>Role</h1><p>Build &amp; ship</p><script>var x = 1</script></body></html>'
    expect(htmlToText(html)).toBe('Role Build & ship')
  })

  it('decodes numeric entities', () => {
    expect(htmlToText('<p>caf&#233; &#x2014; bar</p>')).toBe('café — bar')
  })

  it('leaves an unknown entity alone', () => {
    expect(htmlToText('<p>&notreal;</p>')).toBe('&notreal;')
  })
})

describe('loadJobDescription', () => {
  it('returns pasted text without touching the network', async () => {
    const result = await loadJobDescription('  Senior Engineer  ')
    expect(result.source).toEqual({ kind: 'text', text: 'Senior Engineer' })
    expect(result.text).toBe('Senior Engineer')
  })

  it('fetches a URL and reduces the page to readable text', async () => {
    const result = await loadJobDescription('https://example.com/jobs/1', {
      fetchImpl: fetchReturning(
        '<html><body><h1>Staff Engineer</h1><p>Own the roadmap.</p></body></html>',
      ),
    })
    expect(result.source).toEqual({ kind: 'url', url: 'https://example.com/jobs/1' })
    expect(result.text).toBe('Staff Engineer Own the roadmap.')
  })

  it('fails loudly when the page cannot be fetched', async () => {
    await expect(
      loadJobDescription('https://example.com/jobs/1', { fetchImpl: fetchReturning('gone', 404) }),
    ).rejects.toThrow(/HTTP 404/)
  })

  it('fails loudly when the page has no readable text', async () => {
    await expect(
      loadJobDescription('https://example.com/jobs/1', {
        fetchImpl: fetchReturning('<script>var x = 1</script>'),
      }),
    ).rejects.toThrow(/no readable text/)
  })
})
