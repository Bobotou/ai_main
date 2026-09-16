import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('未登录');
    try {
      req.userId = this.jwt.verify(token).sub;
      return true;
    } catch {
      throw new UnauthorizedException('登录已过期');
    }
  }
}

/** 从 req.userId 取当前用户 id(需配合 UseGuards(JwtAuthGuard)) */
export function currentUserId(req: { userId?: string }): string {
  if (!req.userId) throw new UnauthorizedException();
  return req.userId;
}
