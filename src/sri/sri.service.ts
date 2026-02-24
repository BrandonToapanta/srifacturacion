import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import * as soap from 'soap';
import { FirmaService } from './firma.service';

export interface RespuestaSri {
	estado: 'AUTORIZADO' | 'NO AUTORIZADO' | 'DEVUELTA' | 'EN PROCESO';
	numeroAutorizacion?: string;
	fechaAutorizacion?: string;
	xmlFirmado: string;
	errores?: { identificador: string; mensaje: string; tipo: string }[];
}

@Injectable()
export class SriService {
	// Cambia estas URLs a producción cuando corresponda
	private readonly URL_RECEPCION = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl';
	private readonly URL_AUTORIZACION = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';

	// Ruta y clave del certificado .p12 (idealmente desde ConfigService)
	private readonly P12_PATH = process.env.P12_PATH || './privilegio.p12';
	private readonly P12_PASS = process.env.P12_PASS || 'tu_contraseña';

	constructor(private readonly firmaService: FirmaService) { }

	// ── Flujo completo ─────────────────────────────────────────────────────────
	async procesarComprobante(xml: string): Promise<RespuestaSri> {
		try {
			// 1. Firmar
			const xmlFirmado = this.firmaService.firmarXml(xml, this.P12_PATH, this.P12_PASS);

			// 2. Extraer clave de acceso del XML
			const claveAcceso = this.extraerClaveAcceso(xmlFirmado);

			// 3. Enviar al SRI
			const recepcion = await this.enviarComprobante(xmlFirmado);
			if (recepcion.estado === 'DEVUELTA') {
				return { estado: 'DEVUELTA', xmlFirmado, errores: recepcion.errores };
			}

			// 4. Polling de autorización
			const autorizacion = await this.esperarAutorizacion(claveAcceso);
			return { ...autorizacion, xmlFirmado };

		} catch (e: any) {
			console.error('=== ERROR EN procesarComprobante ===');
			console.error('Mensaje:', e.message);
			console.error('Stack:', e.stack);
			throw new InternalServerErrorException(e.message); // <-- ahora verás el mensaje real
		}
	}

	// ── Paso 1: Enviar al WS de recepción ─────────────────────────────────────
	private async enviarComprobante(xmlFirmado: string) {
		const xmlBase64 = Buffer.from(xmlFirmado, 'utf-8').toString('base64');
		try {
			const client = await soap.createClientAsync(this.URL_RECEPCION);
			const [result] = await client.validarComprobanteAsync({ xml: xmlBase64 });
			const respuesta = result?.RespuestaRecepcionComprobante;
			const estado = respuesta?.estado;
			const mensajes = respuesta?.comprobantes?.comprobante?.mensajes?.mensaje;
			const errores = mensajes
				? (Array.isArray(mensajes) ? mensajes : [mensajes])
				: [];
			return { estado, errores };
		} catch (e) {
			throw new InternalServerErrorException(`Error WS recepción SRI: ${e.message}`);
		}
	}

	// ── Paso 2: Consultar autorización con reintentos ──────────────────────────
	private async esperarAutorizacion(
		claveAcceso: string,
		intentos = 6,
		esperaMs = 3000,
	): Promise<Omit<RespuestaSri, 'xmlFirmado'>> {
		for (let i = 0; i < intentos; i++) {
			await new Promise((r) => setTimeout(r, esperaMs));
			try {
				const client = await soap.createClientAsync(this.URL_AUTORIZACION);
				const [result] = await client.autorizacionComprobanteAsync({
					claveAccesoComprobante: claveAcceso,
				});

				const autorizacion =
					result?.RespuestaAutorizacionComprobante?.autorizaciones?.autorizacion;
				const estado = autorizacion?.estado;
				const mensajes = autorizacion?.mensajes?.mensaje;
				const errores = mensajes
					? (Array.isArray(mensajes) ? mensajes : [mensajes])
					: [];

				if (estado === 'AUTORIZADO') {
					return {
						estado,
						numeroAutorizacion: autorizacion.numeroAutorizacion,
						fechaAutorizacion: autorizacion.fechaAutorizacion,
						errores,
					};
				}

				if (estado === 'NO AUTORIZADO') {
					return { estado, errores };
				}
				// EN PROCESO → reintenta
			} catch (e) {
				throw new InternalServerErrorException(`Error WS autorización SRI: ${e.message}`);
			}
		}
		return { estado: 'EN PROCESO', errores: [] };
	}

	// ── Helpers ────────────────────────────────────────────────────────────────
	private extraerClaveAcceso(xml: string): string {
		const match = xml.match(/<claveAcceso>([^<]+)<\/claveAcceso>/);
		if (!match) throw new BadRequestException('No se encontró claveAcceso en el XML');
		return match[1].trim();
	}
}