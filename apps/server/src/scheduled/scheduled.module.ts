import { Module } from '@nestjs/common';
import { ScheduledWorker } from './scheduled.worker';
import { PrismaService } from '../prisma.service';
import { AccountsModule } from '../accounts/accounts.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [AccountsModule, MessagesModule],
  providers: [ScheduledWorker, PrismaService],
})
export class ScheduledModule {}
