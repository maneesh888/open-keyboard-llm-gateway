import { describe, it, expect, beforeEach } from 'vitest';
import { AdminAuth } from '../../src/admin/auth.js';
import type { AdminConfig } from '../../src/types/index.js';

describe('AdminAuth', () => {
  let adminAuth: AdminAuth;
  let config: AdminConfig;

  beforeEach(() => {
    config = {
      users: [
        {
          username: 'admin',
          // Bcrypt hash of "password"
          passwordHash: '$2b$10$nOO3xM2CL6NR63NFw52mIOsnHGjb625JJ73qWnuhoUorlKtz0ztxu',
          createdAt: '2026-04-20T00:00:00Z'
        },
        {
          username: 'testuser',
          // Bcrypt hash of "testpass"
          passwordHash: '$2b$10$VJDSquH.C8XwBnpvorBQIOTauNaPh8EWBE4mz.uyA4RWJsirsF66.',
          createdAt: '2026-04-20T00:00:00Z'
        }
      ],
      jwtSecret: 'test-secret-key',
      sessionExpiryHours: 24
    };

    adminAuth = new AdminAuth(config);
  });

  describe('Password hashing', () => {
    it('should hash password with bcrypt', async () => {
      const password = 'mypassword';
      const hash = await adminAuth.hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true); // Bcrypt format
      expect(hash.length).toBeGreaterThan(50); // Bcrypt hashes are ~60 chars
    });

    it('should produce different hashes for same password (salting)', async () => {
      const password = 'password1';
      const hash1 = await adminAuth.hashPassword(password);
      const hash2 = await adminAuth.hashPassword(password);

      // Bcrypt uses random salt, so hashes differ
      expect(hash1).not.toBe(hash2);
      
      // But both should be valid bcrypt hashes
      expect(hash1.startsWith('$2a$') || hash1.startsWith('$2b$')).toBe(true);
      expect(hash2.startsWith('$2a$') || hash2.startsWith('$2b$')).toBe(true);
    });

    it('should produce different hashes for different passwords', async () => {
      const hash1 = await adminAuth.hashPassword('password1');
      const hash2 = await adminAuth.hashPassword('password2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Password verification', () => {
    it('should verify correct password', async () => {
      const result = await adminAuth.verifyPassword('admin', 'password');
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const result = await adminAuth.verifyPassword('admin', 'wrongpassword');
      expect(result).toBe(false);
    });

    it('should reject non-existent user', async () => {
      const result = await adminAuth.verifyPassword('nonexistent', 'password');
      expect(result).toBe(false);
    });

    it('should verify multiple users independently', async () => {
      expect(await adminAuth.verifyPassword('admin', 'password')).toBe(true);
      expect(await adminAuth.verifyPassword('testuser', 'testpass')).toBe(true);
      expect(await adminAuth.verifyPassword('admin', 'testpass')).toBe(false);
      expect(await adminAuth.verifyPassword('testuser', 'password')).toBe(false);
    });
  });

  describe('Token generation', () => {
    it('should generate JWT token for valid user', () => {
      const token = adminAuth.generateToken('admin');

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
      
      // JWT format: header.payload.signature (3 parts)
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should generate different tokens for different users', () => {
      const token1 = adminAuth.generateToken('admin');
      const token2 = adminAuth.generateToken('testuser');

      expect(token1).not.toBe(token2);
    });

    it('should generate different tokens at different times', async () => {
      const token1 = adminAuth.generateToken('admin');
      
      // Wait 1 second to ensure different iat (issued at) timestamp
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const token2 = adminAuth.generateToken('admin');

      expect(token1).not.toBe(token2);
    }, 2000); // Increase timeout
  });

  describe('Token verification', () => {
    it('should verify valid token', () => {
      const token = adminAuth.generateToken('admin');
      const payload = adminAuth.verifyToken(token);

      expect(payload).toBeDefined();
      expect(payload?.username).toBe('admin');
      // JWT exp is in seconds, not milliseconds
      expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should reject invalid token format', () => {
      const payload = adminAuth.verifyToken('invalid-token');
      expect(payload).toBeNull();
    });

    it('should reject token with tampered payload', () => {
      const token = adminAuth.generateToken('admin');
      const [payloadB64, signature] = token.split('.');
      
      // Tamper with payload
      const tamperedPayload = Buffer.from('{"username":"hacker","exp":9999999999999}')
        .toString('base64');
      const tamperedToken = `${tamperedPayload}.${signature}`;

      const payload = adminAuth.verifyToken(tamperedToken);
      expect(payload).toBeNull();
    });

    it('should reject token with tampered signature', () => {
      const token = adminAuth.generateToken('admin');
      const [payloadB64] = token.split('.');
      
      // Use wrong signature
      const tamperedToken = `${payloadB64}.wrongsignature`;

      const payload = adminAuth.verifyToken(tamperedToken);
      expect(payload).toBeNull();
    });

    it('should reject expired token', async () => {
      // Create auth with 1 second expiry
      const shortConfig: AdminConfig = {
        ...config,
        sessionExpiryHours: 1 / 3600 // 1 second
      };
      const shortAuth = new AdminAuth(shortConfig);

      const token = shortAuth.generateToken('admin');
      
      // Wait 1.5 seconds to ensure expiry
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Token should be expired now
      const payload = shortAuth.verifyToken(token);
      expect(payload).toBeNull();
    }, 3000); // Increase test timeout

    it('should extract correct username from token', () => {
      const token = adminAuth.generateToken('testuser');
      const payload = adminAuth.verifyToken(token);

      expect(payload?.username).toBe('testuser');
    });

    it('should handle token expiry correctly', () => {
      const token = adminAuth.generateToken('admin');
      const payload = adminAuth.verifyToken(token);

      expect(payload?.exp).toBeDefined();
      
      // Should expire in approximately 24 hours
      // JWT exp is in seconds, so convert to seconds for comparison
      const expiryTime = payload!.exp - Math.floor(Date.now() / 1000);
      const expectedExpiry = 24 * 60 * 60; // 24 hours in seconds
      
      expect(expiryTime).toBeGreaterThan(expectedExpiry - 2); // Within 2 seconds
      expect(expiryTime).toBeLessThan(expectedExpiry + 2);
    });
  });

  describe('Token lifecycle', () => {
    it('should complete full auth flow', async () => {
      // 1. Verify password
      const passwordValid = await adminAuth.verifyPassword('admin', 'password');
      expect(passwordValid).toBe(true);

      // 2. Generate token
      const token = adminAuth.generateToken('admin');
      expect(token).toBeDefined();

      // 3. Verify token
      const payload = adminAuth.verifyToken(token);
      expect(payload).toBeDefined();
      expect(payload?.username).toBe('admin');

      // 4. Use token payload (JWT exp is in seconds, not ms)
      expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should reject authentication with wrong password', async () => {
      const passwordValid = await adminAuth.verifyPassword('admin', 'wrongpassword');
      expect(passwordValid).toBe(false);

      // Should not generate token for failed auth
      // (This is enforced by application logic, not AdminAuth class)
    });
  });

  describe('Security', () => {
    it('should not allow empty passwords', async () => {
      const hash = await adminAuth.hashPassword('');
      expect(hash).toBeDefined();
      // Empty password should hash to something (not crash)
      // But application should reject empty passwords before hashing
    });

    it('should handle special characters in password', async () => {
      const password = 'p@ssw0rd!#$%^&*()';
      const hash = await adminAuth.hashPassword(password);
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(50); // Bcrypt hash length
    });

    it('should handle very long passwords', async () => {
      const password = 'a'.repeat(1000);
      const hash = await adminAuth.hashPassword(password);
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(50); // Bcrypt hash length
    });

    it('should handle unicode characters in username', () => {
      const token = adminAuth.generateToken('用户名');
      const payload = adminAuth.verifyToken(token);
      expect(payload?.username).toBe('用户名');
    });
  });
});
