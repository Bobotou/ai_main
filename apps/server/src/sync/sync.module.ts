import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PrismaService } from '../prisma.service';
import { AccountsModule } from '../accounts/accounts.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [AccountsModule, MessagesModule],
  controllers: [SyncController],
  providers: [SyncService, PrismaService],
})
export class SyncModule {}
