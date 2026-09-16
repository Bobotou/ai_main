import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Response } from 'express';
import { MessagesService } from './messages.service';
import { JwtAuthGuard, currentUserId } from '../auth/jwt-auth.guard';
import type { MessageListQuery, OutgoingAttachment, SendMessageRequest } from '@ai-mail/shared';

class SendDto implements SendMessageRequest {
  @IsString() accountId!: string;
  @IsArray() to!: { address: string; name?: string }[];
  @IsOptional() @IsArray() cc?: { address: string; name?: string }[];
  @IsOptional() @IsArray() bcc?: { address: string; name?: string }[];
  @IsString() subject!: string;
  @IsString() bodyHtml!: string;
  @IsOptional() @IsString() scheduledAt?: string;
  @IsOptional() @IsArray() attachments?: OutgoingAttachment[];
}

class ListQueryDto implements MessageListQuery {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsIn(['inbox', 'sent', 'drafts', 'archived', 'trash', 'starred']) folder?: MessageListQuery['folder'];
  @IsOptional() @IsIn(['important', 'notification', 'marketing', 'social', 'other']) category?: MessageListQuery['category'];
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Boolean) unreadOnly?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

class PatchDto {
  @IsBoolean() isRead?: boolean;
  @IsBoolean() isStarred?: boolean;
  @IsIn(['important', 'notification', 'marketing', 'social', 'other']) aiCategory?: string;
}

@Controller('api/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get()
  list(@Req() req: { userId?: string }, @Query() query: ListQueryDto) {
    return this.messages.list(currentUserId(req), query);
  }

  @Get('scheduled')
  scheduled(@Req() req: { userId?: string }) {
    return this.messages.listScheduled(currentUserId(req));
  }

  @Get(':id')
  get(@Req() req: { userId?: string }, @Param('id') id: string) {
    return this.messages.get(currentUserId(req), id);
  }

  /** 附件下载(带 Content-Disposition,中文文件名走 RFC 5987) */
  @Get(':id/attachments/:attachmentId')
  async downloadAttachment(
    @Req() req: { userId?: string },
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const { attachment, content } = await this.messages.getAttachment(currentUserId(req), id, attachmentId);
    const encoded = encodeURIComponent(attachment.filename);
    res.setHeader('content-type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('content-disposition',
      `attachment; filename="${encoded.replace(/["\\]/g, '')}"; filename*=UTF-8''${encoded}`);
    res.setHeader('content-length', content.length);
    res.end(content);
  }

  @Post()
  send(@Req() req: { userId?: string }, @Body() dto: SendDto) {
    return this.messages.send(currentUserId(req), dto);
  }

  @Delete('scheduled/:id')
  cancelScheduled(@Req() req: { userId?: string }, @Param('id') id: string) {
    return this.messages.cancelScheduled(currentUserId(req), id);
  }

  @Patch(':id')
  patch(@Req() req: { userId?: string }, @Param('id') id: string, @Body() dto: PatchDto) {
    const userId = currentUserId(req);
    if (dto.isRead !== undefined) return this.messages.markRead(userId, id, dto.isRead);
    if (dto.isStarred !== undefined) return this.messages.star(userId, id, dto.isStarred);
    if (dto.aiCategory !== undefined) return this.messages.correctCategory(userId, id, dto.aiCategory);
  }
}
