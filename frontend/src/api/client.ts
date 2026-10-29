import * as Sentry from '@sentry/react';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '') + '/api/v1';

export interface Violation {
  property_path: string;
  title: string;
}

/** RFC 7807 problem details returned by the backend. */
export interface Problem {
  title?: string;
  status?: number;
  detail?: string;
  violations?: Violation[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? (status === 0 ? 'Cannot reach the server.' : `HTTP error ${status}`));
  }

  /** Field name -> first error message, for inline form errors. */
  get fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const violation of this.problem?.violations ?? []) {
      errors[violation.property_path] ??= violation.title;
    }
    return errors;
  }
}

export type TokenProvider = () => string | null;

let tokenProvider: TokenProvider = () => null;
let onUnauthorized: () => void = () => {};

export function configureApi(options: { token: TokenProvider; onUnauthorized: () => void }): void {
  tokenProvider = options.token;
  onUnauthorized = options.onUnauthorized;
}

export async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, null);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized();
    const error = new ApiError(response.status, data);
    // 4xx are the player's input; a 5xx is a bug worth an Issue.
    if (response.status >= 500) Sentry.captureException(error, { tags: { api: `${method} ${path.split('?')[0]}` } });
    throw error;
  }
  return data as T;
}
