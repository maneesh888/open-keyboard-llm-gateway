export interface CustomAction {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
}

export interface ClientFeatures {
  suggestions: boolean;
  customActions: CustomAction[];
}

export interface ModelConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstAllowance: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  rateLimit?: number; // Deprecated: use rateLimitConfig
  rateLimitConfig?: RateLimitConfig;
  allowedModels?: string[];
  features?: ClientFeatures;
  modelConfig?: ModelConfig;
  owner?: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface KeysConfig {
  keys: ApiKey[];
}

export interface AppConfig {
  port: number;
  ollamaHost: string;
  logLevel: string;
  corsOrigins: string[];
  trustedProxies?: string[]; // CIDR ranges of trusted reverse proxies (e.g. Cloudflare)
}

export interface RequestLog {
  timestamp: string;
  keyName: string;
  keyId: string;
  method: string;
  path: string;
  model?: string;
  clientIp?: string;
  statusCode: number;
  responseTimeMs: number;
}

export interface AdminUser {
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface AdminConfig {
  users: AdminUser[];
  jwtSecret: string;
  sessionExpiryHours: number;
}

export interface AuthToken {
  username: string;
  exp: number;
}
