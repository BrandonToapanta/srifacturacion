import { Module } from '@nestjs/common';
import { SriController } from './sri.controller';
import { SriService } from './sri.service';
import { FirmaService } from './firma.service';
import { ClaveAccesoService } from './claveAcceso.service';
import { DatabaseService } from './database.service';
import { FacturaPdfService } from './facturaPdf.service';
import { SftpService } from './sftp.service';
import { SftpProcesadorService } from './sftpProcesador.service';
import { SftpWatcherService } from './sftpWatcher.service';

@Module({
  controllers: [SriController],
  providers: [
    DatabaseService,
    SriService,
    FirmaService,
    ClaveAccesoService,
    FacturaPdfService,
    SftpService,
    SftpProcesadorService,
    SftpWatcherService,
  ],
  exports: [SriService],
})
export class SriModule { }