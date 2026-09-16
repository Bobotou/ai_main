// 凭据加密(对应技术架构 §8.1)
// AES-256-GCM;密钥 = MASTER_KEY(HKDF 派生按账号,当前用全局主密钥,按用户派生列入 M2)

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CryptoService {
  private masterKey(): Buffer {
    const hex = process.env.MASTER_KEY ?? '';
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error('MASTER_KEY 未配置或格式错误(需 32 字节 hex,openssl rand -hex 32 生成)');
    }
    return Buffer.from(hex, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey(), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
