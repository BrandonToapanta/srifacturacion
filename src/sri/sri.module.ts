// sri.module.ts
import { Module } from '@nestjs/common';
import { SriController } from './sri.controller';
import { SriService } from './sri.service';
import { FirmaService } from './firma.service';
import { ClaveAccesoService } from './claveAcceso.service';
import { DatabaseService } from './database.service';
import { FacturaPdfService } from './facturaPdf.service';

@Module({
  controllers: [SriController],
  providers: [SriService, FirmaService, ClaveAccesoService, DatabaseService, FacturaPdfService],
  exports: [SriService],
})
export class SriModule { }