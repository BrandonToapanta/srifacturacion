// sri.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, Get, Param } from '@nestjs/common';
import { SriService, RespuestaSri } from './sri.service';
import { FirmarEnviarDto } from './dto/firmar-enviar.dto';

@Controller('sri')
export class SriController {

	constructor(private readonly sriService: SriService) { }

	@Post('enviar')
	@HttpCode(HttpStatus.OK)
	async enviarComprobante(@Body() dto: FirmarEnviarDto) {
		return this.sriService.procesarComprobante(dto.xml);
	}

	@Get('consultar/:clave')
	async consultarClave(@Param('clave') clave: string) {
		return this.sriService.consultarClaveDirecta(clave);
	}

	@Post('diagnostico')
	async diagnostico(@Body() dto: { xmlFirmado: string }) {
		return this.sriService.diagnosticarFirma(dto.xmlFirmado);
	}
}