import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma.service';
import { AiModule } from '../ai/ai.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [AiModule, ContactsModule],
  controllers: [MessagesController],
  providers: [MessagesService, PrismaService],
  exports: [MessagesService],
})
export class MessagesModule {}
