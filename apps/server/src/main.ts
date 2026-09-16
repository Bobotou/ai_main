import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  // 附件以 base64 随 JSON 上传,放宽默认 100kb 限制(25MB 附件 base64 后约 33MB)
  app.use(json({ limit: '40mb' }));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[ai-mail] API listening on :${port}`);
}
bootstrap();
