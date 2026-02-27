import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SriModule } from './sri/sri.module';

@Module({
  imports: [SriModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
