import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { CryptoService } from './crypto.service';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { MessagesModule } from './messages/messages.module';
import { SyncModule } from './sync/sync.module';
import { ScheduledModule } from './scheduled/scheduled.module';
import { ContactsModule } from './contacts/contacts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    AccountsModule,
    MessagesModule,
    SyncModule,
    ScheduledModule,
    ContactsModule,
  ],
  providers: [PrismaService, CryptoService],
  exports: [PrismaService, CryptoService],
})
export class AppModule {}
