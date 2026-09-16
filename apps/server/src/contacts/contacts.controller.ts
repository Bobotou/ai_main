import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard, currentUserId } from '../auth/jwt-auth.guard';
import type { ContactCreateRequest, ContactUpdateRequest } from '@ai-mail/shared';

class CreateDto implements ContactCreateRequest {
  @IsEmail({}, { message: '邮箱地址无效' })
  email!: string;

  @IsOptional() @IsString() @MaxLength(120)
  name?: string;
}

class UpdateDto implements ContactUpdateRequest {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;
}

@Controller('api/contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private contacts: ContactsService) {}

  @Get()
  list(@Req() req: { userId?: string }, @Query('q') q?: string) {
    return this.contacts.list(currentUserId(req), q);
  }

  @Post()
  create(@Req() req: { userId?: string }, @Body() dto: CreateDto) {
    return this.contacts.create(currentUserId(req), dto.email, dto.name);
  }

  @Patch(':id')
  update(@Req() req: { userId?: string }, @Param('id') id: string, @Body() dto: UpdateDto) {
    return this.contacts.update(currentUserId(req), id, dto.name ?? null);
  }

  @Delete(':id')
  async remove(@Req() req: { userId?: string }, @Param('id') id: string) {
    await this.contacts.remove(currentUserId(req), id);
    return { ok: true };
  }
}
