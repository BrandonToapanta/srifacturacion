// dto/firmar-enviar.dto.ts
import { IsString } from 'class-validator';

export class FirmarEnviarDto {
	@IsString()
	xml: string;        // XML del comprobante sin firmar
}