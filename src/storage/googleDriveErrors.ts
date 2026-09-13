/**
 * Structured, sanitized error model for Google Drive operations.
 * Redacts and prevents exposure of sensitive tokens, headers, or raw response bodies.
 */

export type GoogleDriveErrorCode =
  | 'UNAUTHORIZED'       // HTTP 401: Invalid, revoked, or expired token
  | 'FORBIDDEN'          // HTTP 403: Insufficient permission or scope
  | 'NOT_FOUND'          // HTTP 404: File or folder not found
  | 'RATE_LIMITED'       // HTTP 429: API rate limit exceeded
  | 'SERVER_ERROR'       // HTTP 5xx: Google Drive service error
  | 'MISSING_TOKEN'      // Token provider returned null, empty, or undefined
  | 'NETWORK_ERROR'      // Fetch network failure (offline, DNS, timeout)
  | 'MALFORMED_RESPONSE' // Invalid JSON or unexpected response format
  | 'INVALID_CONTENT';   // Corrupt or non-Excalidraw file content

const SAFE_ERROR_MESSAGES: Record<GoogleDriveErrorCode, string> = {
  UNAUTHORIZED: 'Google Drive access token is invalid or expired. Please sign in again.',
  FORBIDDEN: 'Permission denied to access Google Drive file.',
  NOT_FOUND: 'Drawing or folder not found in Google Drive.',
  RATE_LIMITED: 'Google Drive rate limit reached. Please wait a moment and try again.',
  SERVER_ERROR: 'Google Drive service is temporarily unavailable. Please try again later.',
  MISSING_TOKEN: 'No active Google Drive access token available. Please sign in.',
  NETWORK_ERROR: 'Network error communicating with Google Drive. Please check your connection.',
  MALFORMED_RESPONSE: 'Received an invalid response from Google Drive.',
  INVALID_CONTENT: 'Drawing content is corrupt or does not match valid Excalidraw format.',
};

export class GoogleDriveError extends Error {
  public readonly code: GoogleDriveErrorCode;
  public readonly status?: number;
  public readonly isRetryable: boolean;

  constructor(code: GoogleDriveErrorCode, customMessage?: string, status?: number) {
    // Ensure message is safe and does not contain tokens or sensitive details
    const message = customMessage ? sanitizeErrorMessage(customMessage) : SAFE_ERROR_MESSAGES[code];
    super(message);
    this.name = 'GoogleDriveError';
    this.code = code;
    this.status = status;
    this.isRetryable = code === 'RATE_LIMITED' || code === 'SERVER_ERROR' || code === 'NETWORK_ERROR';

    // Ensure prototype chain is properly restored
    Object.setPrototypeOf(this, GoogleDriveError.prototype);
  }
}

/**
 * Strips potential access tokens, Bearer headers, and URL query params from error messages.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return 'An unexpected Google Drive error occurred.';
  }

  return message
    // Redact Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    // Redact access_token parameters
    .replace(/access_token=[A-Za-z0-9._~+/-]+/gi, 'access_token=[REDACTED]')
    // Redact client_id / secret
    .replace(/client_secret=[A-Za-z0-9._~+/-]+/gi, 'client_secret=[REDACTED]')
    // Truncate overly long response strings
    .slice(0, 300);
}

/**
 * Maps HTTP status codes to standardized GoogleDriveError instances.
 */
export function createGoogleDriveErrorFromStatus(status: number, statusText?: string): GoogleDriveError {
  switch (status) {
    case 401:
      return new GoogleDriveError('UNAUTHORIZED', undefined, 401);
    case 403:
      return new GoogleDriveError('FORBIDDEN', undefined, 403);
    case 404:
      return new GoogleDriveError('NOT_FOUND', undefined, 404);
    case 429:
      return new GoogleDriveError('RATE_LIMITED', undefined, 429);
    default:
      if (status >= 500 && status < 600) {
        return new GoogleDriveError('SERVER_ERROR', undefined, status);
      }
      return new GoogleDriveError(
        'MALFORMED_RESPONSE',
        statusText ? `Google Drive request failed (${status} ${statusText})` : `Google Drive request failed (${status})`,
        status
      );
  }
}
