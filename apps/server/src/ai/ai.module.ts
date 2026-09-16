import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiGateway } from './ai.gateway';
import { AiConfigService } from './ai-config.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../crypto.service';

@Module({
  controllers: [AiController],
  providers: [AiService, AiGateway, AiConfigService, PrismaService, CryptoService],
  exports: [AiService],
})
export class AiModule {}
