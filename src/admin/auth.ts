import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AdminConfig, AuthToken } from '../types/index.js';

const BCRYPT_SALT_ROUNDS = 12;

export class AdminAuth {
  private config: AdminConfig;

  constructor(config: AdminConfig) {
    this.config = config;
  }

  /**
   * Hash password using bcrypt (secure, industry-standard)
   * @param password Plain text password
   * @returns Bcrypt hash
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  /**
   * Hash password synchronously (for backward compatibility with tests)
   * @deprecated Use hashPassword() instead
   */
  hashPasswordSync(password: string): string {
    return bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
  }

  /**
   * Verify password against bcrypt hash
   */
  async verifyPassword(username: string, password: string): Promise<boolean> {
    const user = this.config.users.find(u => u.username === username);
    if (!user) return false;

    try {
      return await bcrypt.compare(password, user.passwordHash);
    } catch {
      return false;
    }
  }

  /**
   * Generate JWT token
   */
  generateToken(username: string): string {
    const expiresIn = this.config.sessionExpiryHours * 3600; // Convert to seconds
    
    const payload = {
      username
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): AuthToken | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as AuthToken;
      return decoded;
    } catch {
      return null;
    }
  }
}
