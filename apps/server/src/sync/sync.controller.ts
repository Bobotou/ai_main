import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { JwtAuthGuard, currentUserId } from '../auth/jwt-auth.guard';

@Controller('api/accounts')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private sync: SyncService) {}

  /** 手动「立即同步」(设置页/刷新按钮) */
  @Post(':id/sync')
  syncNow(@Req() req: { userId?: string }, @Param('id') id: string) {
    return this.sync.syncNow(currentUserId(req), id);
  }
}
