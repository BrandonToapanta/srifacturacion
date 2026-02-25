// sri.module.ts
import { Module } from '@nestjs/common';
import { SriController } from './sri.controller';
import { SriService } from './sri.service';
import { FirmaService } from './firma.service';
import { ClaveAccesoService } from './claveAcceso.service';

@Module({
  controllers: [SriController],
  providers: [SriService, FirmaService, ClaveAccesoService],
  exports: [SriService],
})
export class SriModule { }