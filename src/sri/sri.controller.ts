// sri.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, Get, Param } from '@nestjs/common';
import { SriService, RespuestaSri } from './sri.service';
import { FirmarEnviarDto } from './dto/firmar-enviar.dto';
import { SftpProcesadorService } from './sftpProcesador.service';
import { SftpWatcherService } from './sftpWatcher.service';
import { SftpService } from './sftp.service';

@Controller('sri')
export class SriController {

	constructor(
		private readonly sriService: SriService,
		private readonly sftpProcesadorService: SftpProcesadorService,
		private readonly sftpWatcherService: SftpWatcherService,
		private readonly sftpService: SftpService,
	) { }

	@Post('enviar')
	@HttpCode(HttpStatus.OK)
	async enviarComprobante(@Body() dto: FirmarEnviarDto) {
		return this.sriService.procesarComprobante(dto.xml);
	}

	@Get('consultar/:clave')
	async consultarClave(@Param('clave') clave: string) {
		return this.sriService.consultarClaveDirecta(clave);
	}

	@Get('sftp/estado')
	getEstadoWatcher() {
		return this.sftpWatcherService.getEstado();
	}

	@Post('sftp/forzar')
	async forzarRevision() {
		await this.sftpWatcherService.forzarRevision();
		return { mensaje: 'Revisión iniciada' };
	}

	@Post('sftp/limpiar')
	limpiarWatcher() {
		this.sftpWatcherService.limpiarConocidos();
		return { mensaje: 'Memoria limpiada, se reprocesarán archivos en próxima revisión' };
	}

	@Post('sftp/procesar')
	async procesarManual() {
		return this.sftpProcesadorService.procesarTodos();
	}

	@Get('sftp/conexion')
	async verificarConexion() {
		const ok = await this.sftpService.verificarConexion();
		return {
			conectado: ok,
			host: process.env.SFTP_HOST,
			mensaje: ok ? 'Conexión exitosa' : 'Error de conexión',
		};
	}

}