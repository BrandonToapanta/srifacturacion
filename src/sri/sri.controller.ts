// sri.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SriService, RespuestaSri } from './sri.service';
import { FirmarEnviarDto } from './dto/firmar-enviar.dto';

@Controller('sri')
export class SriController {

	constructor(private readonly sriService: SriService) { }

	@Post('enviar')
	@HttpCode(HttpStatus.OK)
	async enviarComprobante(@Body() dto: FirmarEnviarDto) {
		console.log('Body recibido:', JSON.stringify(dto));  // <-- verifica qué llega
		console.log('XML recibido:', dto.xml);
		return this.sriService.procesarComprobante(dto.xml);
	}
}