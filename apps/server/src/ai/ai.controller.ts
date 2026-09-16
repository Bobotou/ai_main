import { Body, BadRequestException, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { AiService, AiUnavailableError } from './ai.service';
import { AiConfigService } from './ai-config.service';
import { JwtAuthGuard, currentUserId } from '../auth/jwt-auth.guard';
import type { AiDraftRequest, AiRewriteRequest } from '@ai-mail/shared';

class SaveConfigDto {
  @IsString() baseUrl!: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsString() modelChat!: string;
  @IsOptional() @IsString() modelLight?: string;
  @IsBoolean() enabled!: boolean;
}

class TestConfigDto {
  @IsString() baseUrl!: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsString() model!: string;
}

class DraftDto implements AiDraftRequest {
  @IsString() intent!: string;
  @IsOptional() @IsIn(['formal', 'friendly', 'concise', 'apologetic']) tone?: AiDraftRequest['tone'];
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() contextMessageId?: string;
  @IsOptional() @IsString() previousDraft?: string;
  @IsOptional() @IsString() followUpInstruction?: string;
}

class RewriteDto implements AiRewriteRequest {
  @IsString() text!: string;
  @IsIn(['formal', 'friendly', 'concise', 'polite', 'translate', 'confident', 'polish', 'expand', 'reply-positive', 'reply-decline', 'to-en', 'to-zh']) action!: AiRewriteRequest['action'];
  @IsOptional() @IsString() targetLanguage?: string;
  @IsOptional() @IsString() contextMessageId?: string;
}

@Controller('api/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private ai: AiService,
    private aiConfig: AiConfigService,
  ) {}

  @Get('config')
  getConfig(@Req() req: { userId?: string }) {
    return this.aiConfig.getView(currentUserId(req));
  }

  @Post('config')
  saveConfig(@Req() req: { userId?: string }, @Body() dto: SaveConfigDto) {
    return this.aiConfig.save(currentUserId(req), dto);
  }

  @Post('config/test')
  testConfig(@Req() req: { userId?: string }, @Body() dto: TestConfigDto) {
    return this.aiConfig.test(currentUserId(req), dto);
  }

  @Get('usage')
  usage(@Req() req: { userId?: string }) {
    return this.ai.usage(currentUserId(req));
  }

  @Post('draft')
  async draft(@Req() req: { userId?: string }, @Body() dto: DraftDto) {
    // 注意:必须包成对象返回。Nest 对字符串返回体不做 JSON 编码,前端解析会失败
    try {
      return { text: await this.ai.draft(currentUserId(req), dto) };
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Post('rewrite')
  async rewrite(@Req() req: { userId?: string }, @Body() dto: RewriteDto) {
    try {
      return { text: await this.ai.rewrite(currentUserId(req), dto) };
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Post('messages/:id/suggestions')
  async suggestions(@Req() req: { userId?: string }, @Param('id') id: string) {
    try {
      return await this.ai.replySuggestions(currentUserId(req), id);
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Post('messages/:id/summarize')
  async summarize(@Req() req: { userId?: string }, @Param('id') id: string, @Query('force') force?: string) {
    try {
      return { text: await this.ai.summarize(id, force === '1' || force === 'true') };
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
