/**
 * R-001 - Accept a pasted job description or a job description URL.
 *
 * The bot can be handed a job description in two shapes: raw pasted text, or a
 * URL that points at one. This module turns either shape into a single
 * normalized result so downstream steps never have to branch on the input.
 */

export type JobDescriptionSource =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string };

export interface ResolvedJobDescription {
  source: JobDescriptionSource;
  /** Plain-text job description, ready for downstream parsing. */
  text: string;
  /** Present only when the input was a URL. */
  url?: string;
}

export class JobDescriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobDescriptionError';
  }
}

export interface JobDescriptionFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export type JobDescriptionFetch = (
  url: string,
) => Promise<JobDescriptionFetchResponse>;

const HTTP_URL = /^https?:\/\/\S+$/i;

const HTML_TAG =
  /<(?:!doctype|html|head|body|main|article|section|div|p|span|a|ul|ol|li|h[1-6]|br|table|tr|td|strong|em)\b/i;

const BLOCK_CLOSE =
  /<\/(?:p|div|section|article|main|header|footer|li|ul|ol|h[1-6]|tr|table|blockquote|pre|html|body)>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function isJobDescriptionUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!HTTP_URL.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function classifyJobDescriptionInput(
  input: string,
): JobDescriptionSource {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new JobDescriptionError('Job description input is empty');
  }
  if (isJobDescriptionUrl(trimmed)) {
    return { kind: 'url', url: trimmed };
  }
  return { kind: 'text', text: trimmed };
}

export async function resolveJobDescription(
  input: string,
  fetchImpl?: JobDescriptionFetch,
): Promise<ResolvedJobDescription> {
  const source = classifyJobDescriptionInput(input);
  if (source.kind === 'text') {
    return { source, text: source.text };
  }

  const doFetch = fetchImpl ?? defaultFetch();

  let response: JobDescriptionFetchResponse;
  try {
    response = await doFetch(source.url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new JobDescriptionError(
      `Failed to fetch job description from ${source.url}: ${reason}`,
    );
  }

  if (!response.ok) {
    const status = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status);
    throw new JobDescriptionError(
      `Failed to fetch job description from ${source.url}: HTTP ${status}`,
    );
  }

  const body = await response.text();
  const text = normalizeFetchedBody(body, response.headers);
  if (text.length === 0) {
    throw new JobDescriptionError(
      `Job description at ${source.url} was empty`,
    );
  }

  return { source, text, url: source.url };
}

export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(
    /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  );
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(BLOCK_CLOSE, '\n');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/[^\S\n]+/g, ' ');
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi,
    (match, entity: string) => {
      if (entity.startsWith('#')) {
        const hex = entity[1] === 'x' || entity[1] === 'X';
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function looksLikeHtml(body: string): boolean {
  return HTML_TAG.test(body);
}

function normalizeFetchedBody(
  body: string,
  headers?: { get(name: string): string | null },
): string {
  const contentType = headers?.get('content-type') ?? '';
  const isHtml =
    /text\/html|application\/xhtml\+xml/i.test(contentType) ||
    (contentType.length === 0 && looksLikeHtml(body));
  return isHtml ? htmlToText(body) : body.trim();
}

type GlobalFetch = (
  input: string,
  init?: { redirect?: string; headers?: Record<string, string> },
) => Promise<JobDescriptionFetchResponse>;

function defaultFetch(): JobDescriptionFetch {
  const globalFetch = (globalThis as { fetch?: GlobalFetch }).fetch;
  if (typeof globalFetch !== 'function') {
    throw new JobDescriptionError(
      'No fetch implementation available; pass one to resolveJobDescription',
    );
  }
  return (url) =>
    globalFetch(url, {
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
}
