import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type GatewayErrorCode =
  | 'missing_authorization'
  | 'invalid_authorization_format'
  | 'invalid_api_key'
  | 'rate_limit_exceeded'
  | 'upstream_unreachable'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'unsupported_operation'
  | 'input_text_required'
  | 'stream_not_supported_for_operation'
  | 'stream_not_supported_for_provider'
  | 'unsupported_parameter'
  | 'provider_overloaded'
  | 'provider_unavailable'
  | 'request_too_large'
  | 'model_not_allowed'
  | 'unsupported_response_format'
  | 'invalid_request'
  | 'invalid_upstream_response'
  | 'invalid_stream'
  | 'request_cancelled'
  | 'admin_login_rate_limited'
  | 'admin_invalid_credentials'
  | 'admin_unauthorized'
  | 'admin_invalid_token'
  | 'validation_error'
  | 'key_not_found'
  | 'internal_error';

type OpenAIErrorType =
  | 'authentication_error'
  | 'invalid_request_error'
  | 'rate_limit_error'
  | 'server_error';

function openAIErrorType(status: ContentfulStatusCode): OpenAIErrorType {
  if (status === 401) return 'authentication_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 400 && status < 500) return 'invalid_request_error';
  return 'server_error';
}

export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: GatewayErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return c.json({
    ...extra,
    error: {
      message,
      type: openAIErrorType(status),
      code,
    },
  }, status);
}
