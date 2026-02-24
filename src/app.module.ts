import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SriModule } from './sri/sri.module';

@Module({
  imports: [SriModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
