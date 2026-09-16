import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard, currentUserId } from '../auth/jwt-auth.guard';

class CreateAccountDto {
  @IsEmail() address!: string;
  @IsIn(['gmail', 'qq', '163', 'outlook', 'custom']) provider!: string;
  @IsString() credential!: string;
  @IsString() imapHost!: string;
  @IsInt() @Min(1) @Max(65535) imapPort!: number;
  @IsBoolean() imapTls!: boolean;
  @IsString() smtpHost!: string;
  @IsInt() @Min(1) @Max(65535) smtpPort!: number;
  @IsBoolean() smtpTls!: boolean;
}

class TestConnectionDto extends CreateAccountDto {}

@Controller('api/accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private accounts: AccountsService) {}

  @Get('presets')
  presets() {
    return this.accounts.presets();
  }

  @Post('test')
  test(@Req() req: { userId?: string }, @Body() dto: TestConnectionDto) {
    return this.accounts.testConnection(currentUserId(req), dto);
  }

  @Post()
  create(@Req() req: { userId?: string }, @Body() dto: CreateAccountDto) {
    return this.accounts.create(currentUserId(req), dto);
  }

  @Get()
  list(@Req() req: { userId?: string }) {
    return this.accounts.list(currentUserId(req));
  }

  @Delete(':id')
  remove(@Req() req: { userId?: string }, @Param('id') id: string) {
    return this.accounts.remove(currentUserId(req), id);
  }
}
