import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, PrismaService, CryptoService],
  exports: [AccountsService],
})
export class AccountsModule {}
