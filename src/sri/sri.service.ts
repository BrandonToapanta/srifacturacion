import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { FirmaService } from './firma.service';
import { ClaveAccesoService } from './claveAcceso.service';
import { DatabaseService } from './database.service';

import * as soap from 'soap';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { FacturaPdfService } from './facturaPdf.service';

export interface RespuestaSri {
	estado: 'AUTORIZADO' | 'NO AUTORIZADO' | 'DEVUELTA' | 'EN PROCESO';
	numeroAutorizacion?: string;
	fechaAutorizacion?: string;
	xmlFirmado: string;
	errores?: { identificador: string; mensaje: string; tipo: string }[];
}

@Injectable()
export class SriService {

	private readonly logger = new Logger(SriService.name);

	private readonly URL_RECEPCION = process.env.URL_RECEPCION || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl';
	private readonly URL_AUTORIZACION = process.env.URL_AUTORIZACION || 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';

	private readonly P12_PATH = process.env.P12_PATH || './privilegio.p12';
	private readonly P12_PASS = process.env.P12_PASS || 'TuContraseñaP12';

	private readonly XML_FIRMADOS_DIR = process.env.XML_FIRMADOS_DIR || 'C:\\Users\\ASUS\\OneDrive\\Desktop\\xml_firmado';

	// SSL agent para evitar errores de certificado en pruebas
	// Atención: desactivar la verificación de host/certificado es inseguro en producción.
	// Esto se usa solo para entornos de prueba/VPN cuando el SRI responde por IP.
	private readonly sslAgent = new https.Agent(({
		rejectUnauthorized: false,
		// Evita el error "Hostname/IP does not match certificate's altnames"
		// al omitir la verificación del nombre del servidor.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		checkServerIdentity: (_: string, __: any) => undefined,
	} as any));

	constructor(
		private readonly firmaService: FirmaService,
		private readonly claveAccesoService: ClaveAccesoService,
		private readonly db: DatabaseService,
		private readonly facturaPdfService: FacturaPdfService,
	) { }

	async procesarComprobante(xml: string): Promise<RespuestaSri> {
		try {
			// Forzar ambiente=2 en el XML para produccion
			xml = xml.replace(/<ambiente>[^<]*<\/ambiente>/, `<ambiente>2</ambiente>`);

			const get = (tag: string): string => {
				const match = xml.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`));
				return match?.[1]?.trim() || '';
			};

			const datosBusqueda = {
				ruc: get('ruc'),
				ambiente: get('ambiente'),
				estab: get('estab').padStart(3, '0'),
				pto_emi: get('ptoEmi').padStart(3, '0'),
				secuencial: get('secuencial').padStart(9, '0'),
				cod_doc: get('codDoc').padStart(2, '0'),
			};

			const nombreDoc = `${get('codDoc')}-${get('estab')}${get('ptoEmi')}-${get('secuencial')}`;

			// Buscar si ya existe
			const registroExistente = this.db.buscarCualquierEstado(datosBusqueda);

			if (registroExistente) {

				// Ya fue autorizado — retornar directamente
				if (registroExistente.estado === 'AUTORIZADO') {
					return this.consultarYGenerarPdf(registroExistente.clave_acceso);
				}

				// Está PENDIENTE — reusar la misma clave y reintentar autorización
				if (registroExistente.estado === 'PENDIENTE') {
					this.logger.log(`Reintentando autorización: ${registroExistente.clave_acceso}`);

					// Reconstruir el XML con la clave existente
					let xmlConClave = xml;
					if (xmlConClave.includes('<claveAcceso>')) {
						xmlConClave = xmlConClave.replace(
							/<claveAcceso>[^<]*<\/claveAcceso>/,
							`<claveAcceso>${registroExistente.clave_acceso}</claveAcceso>`
						);
					} else {
						xmlConClave = xmlConClave.replace(
							/(<codDoc>[^<]+<\/codDoc>)/,
							`$1<claveAcceso>${registroExistente.clave_acceso}</claveAcceso>`
						);
					}

					const xmlFirmado = this.firmaService.firmarXml(xmlConClave, this.P12_PATH, this.P12_PASS);

					const recepcion = await this.enviarComprobante(xmlFirmado);
					if (recepcion.estado === 'DEVUELTA') {

						this.logger.warn(`Comprobante devuelto en reintento autorización: ${registroExistente.clave_acceso}`);

						return { estado: 'DEVUELTA', xmlFirmado, errores: recepcion.errores };
					}

					const autorizacion = await this.esperarAutorizacion(registroExistente.clave_acceso);

					if (autorizacion.estado === 'AUTORIZADO') {
						this.guardarXmlFirmado(xmlFirmado, nombreDoc);

						try {
							this.logger.log(`Generando PDF para clave: ${registroExistente.clave_acceso}`);
							const rutaPdf = await this.facturaPdfService.generarDesdeXml(
								xmlFirmado,
								nombreDoc,   // ← mismo nombre que el XML
								autorizacion.numeroAutorizacion,
								String(autorizacion.fechaAutorizacion ?? ''),
							);
							this.logger.log(`PDF generado en: ${rutaPdf}`);
						} catch (pdfError: any) {
							this.logger.error(`Error generando PDF: ${pdfError.message}`);
							this.logger.error(pdfError.stack);
						}


						this.db.actualizarAutorizacion({
							clave_acceso: registroExistente.clave_acceso,
							numero_autorizacion: String(autorizacion.numeroAutorizacion ?? ''),
							fecha_autorizacion: String(autorizacion.fechaAutorizacion ?? ''),
							estado: 'AUTORIZADO',
						});

						this.logger.log(`Comprobante autorizado: ${registroExistente.clave_acceso}`);
					}

					return { ...autorizacion, xmlFirmado };
				}
			}

			const xmlConClave = this.inyectarClaveAcceso(xml);
			const claveAcceso = this.extraerClaveAcceso(xmlConClave);
			const xmlFirmado = this.firmaService.firmarXml(xmlConClave, this.P12_PATH, this.P12_PASS);

			if (!this.claveAccesoService.validarClaveAcceso(claveAcceso)) {
				throw new BadRequestException(`Clave de acceso inválida: ${claveAcceso}`);
			}

			this.db.insertar({
				...datosBusqueda,
				clave_acceso: claveAcceso,
			});

			const recepcion = await this.enviarComprobante(xmlFirmado);
			if (recepcion.estado === 'DEVUELTA') {

				this.logger.warn(`Comprobante devuelto en recepción: ${claveAcceso}`);

				return { estado: 'DEVUELTA', xmlFirmado, errores: recepcion.errores };
			}

			const autorizacion = await this.esperarAutorizacion(claveAcceso);

			if (autorizacion.estado === 'AUTORIZADO') {
				this.guardarXmlFirmado(xmlFirmado, nombreDoc);

				await this.facturaPdfService.generarDesdeXml(
					xmlFirmado,
					nombreDoc,
					autorizacion.numeroAutorizacion,
					String(autorizacion.fechaAutorizacion)
				);

				this.db.actualizarAutorizacion({
					clave_acceso: claveAcceso,
					numero_autorizacion: String(autorizacion.numeroAutorizacion ?? ''),
					fecha_autorizacion: String(autorizacion.fechaAutorizacion ?? ''),
					estado: 'AUTORIZADO',
				});

				this.logger.log(`Comprobante autorizado: ${claveAcceso}`);
			}

			return { ...autorizacion, xmlFirmado };

		} catch (e: any) {
			this.logger.error(`ERROR: ${e.message}`);
			throw new InternalServerErrorException(e.message);
		}
	}

	// Generar e inyectar claveAcceso en el XML
	private inyectarClaveAcceso(xml: string): string {
		// Helper para extraer valor de un tag
		const get = (tag: string): string => {
			const match = xml.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`));
			if (!match) throw new BadRequestException(`No se encontró el tag <${tag}> en el XML`);
			return match[1].trim();
		};

		const claveAcceso = this.claveAccesoService.generarClaveAcceso({
			fechaEmision: get('fechaEmision'),
			codDoc: get('codDoc'),
			ruc: get('ruc'),
			ambiente: get('ambiente'),
			estab: get('estab'),
			ptoEmi: get('ptoEmi'),
			secuencial: get('secuencial'),
			tipoEmision: get('tipoEmision'),
		});

		// Si ya existe <claveAcceso> la reemplaza, si no la inserta después de <codDoc>
		if (xml.includes('<claveAcceso>')) {
			return xml.replace(
				/<claveAcceso>[^<]*<\/claveAcceso>/,
				`<claveAcceso>${claveAcceso}</claveAcceso>`
			);
		}

		return xml.replace(
			/(<codDoc>[^<]+<\/codDoc>)/,
			`$1<claveAcceso>${claveAcceso}</claveAcceso>`
		);
	}

	// Enviar al WS de recepción
	private async enviarComprobante(xmlFirmado: string) {
		const xmlBase64 = Buffer.from(xmlFirmado, 'utf-8').toString('base64');

		const maxAttempts = 3;
		const baseDelayMs = 3000;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const client = await soap.createClientAsync(this.URL_RECEPCION, {
					wsdl_options: { agent: this.sslAgent },
				});
				(client as any).httpClient.requestOptions = { agent: this.sslAgent, timeout: 30000 };

				const [result] = await client.validarComprobanteAsync({ xml: xmlBase64 });

				const respuesta = result?.RespuestaRecepcionComprobante;
				const estado = respuesta?.estado;
				const mensajes = respuesta?.comprobantes?.comprobante?.mensajes?.mensaje;
				const errores = mensajes ? (Array.isArray(mensajes) ? mensajes : [mensajes]) : [];

				// respuesta recibida

				return { estado, errores };

			} catch (e: any) {
				// Registrar error de intento
				this.logger.error(`Error WS recepción SRI (intento ${attempt}): ${e.message}`);

				// Si aún quedan intentos, esperar un tiempo exponencial antes de reintentar
				if (attempt < maxAttempts) {
					const waitMs = baseDelayMs * attempt;
					await new Promise((r) => setTimeout(r, waitMs));
					continue;
				}

				// Último intento fallido — propagar como error controlado
				throw new InternalServerErrorException(`Error WS recepción SRI: ${e.message}`);
			}
		}

		// En caso improbable de que el bucle termine sin return/throw
		throw new InternalServerErrorException('Error WS recepción SRI: intento de envío fallido desconocido');
	}

	private async esperarAutorizacion(
		claveAcceso: string,
		intentos = 10,       // más intentos
		esperaMs = 8000,     // 8 segundos entre cada intento
	): Promise<Omit<RespuestaSri, 'xmlFirmado'>> {
		for (let i = 0; i < intentos; i++) {
			await new Promise((r) => setTimeout(r, esperaMs));
			try {
				const client = await soap.createClientAsync(this.URL_AUTORIZACION, {
					wsdl_options: { agent: this.sslAgent },
				});
				(client as any).httpClient.requestOptions = { agent: this.sslAgent };

				const [result] = await client.autorizacionComprobanteAsync({
					claveAccesoComprobante: claveAcceso,
				});

				const respuesta = result?.RespuestaAutorizacionComprobante;

				// Si la respuesta viene null o sin autorizaciones, reintenta
				if (!respuesta?.autorizaciones?.autorizacion) {
					continue;
				}

				const autorizacion = respuesta.autorizaciones.autorizacion;
				const estado = autorizacion?.estado;
				const mensajes = autorizacion?.mensajes?.mensaje;
				const errores = mensajes
					? (Array.isArray(mensajes) ? mensajes : [mensajes])
					: [];

				this.logger.log(`Estado autorización: ${estado}`);

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

			} catch (e: any) {
				this.logger.error(`Error autorización intento ${i + 1}: ${e.message}`);
				continue;
			}
		}

		return { estado: 'EN PROCESO', errores: [] };
	}

	private extraerClaveAcceso(xml: string): string {
		const match = xml.match(/<claveAcceso>([^<]+)<\/claveAcceso>/);
		if (!match) throw new BadRequestException('No se encontró claveAcceso en el XML');
		return match[1].trim();
	}

	async consultarClaveDirecta(claveAcceso: string) {
		try {
			const client = await soap.createClientAsync(this.URL_AUTORIZACION, {
				wsdl_options: { agent: this.sslAgent },
			});
			(client as any).httpClient.requestOptions = { agent: this.sslAgent };

			const [result] = await client.autorizacionComprobanteAsync({
				claveAccesoComprobante: claveAcceso,
			});

			this.logger.log(`Consulta directa clave: ${claveAcceso}`);

			return result;
		} catch (e: any) {
			return { error: e.message };
		}
	}

	private guardarXmlFirmado(xmlFirmado: string, nomDocumento: string): string {
		try {
			if (!fs.existsSync(this.XML_FIRMADOS_DIR)) {
				fs.mkdirSync(this.XML_FIRMADOS_DIR, { recursive: true });
			}
			const rutaArchivo = path.join(this.XML_FIRMADOS_DIR, `${nomDocumento}.xml`);
			fs.writeFileSync(rutaArchivo, xmlFirmado, 'utf8');
			this.logger.log(`XML firmado guardado doc: ${nomDocumento}.xml`);
			return rutaArchivo;
		} catch (e: any) {
			this.logger.error(`Error al guardar XML: ${e.message}`);
			return '';
		}
	}

	async consultarYGenerarPdf(claveAcceso: string): Promise<any> {
		try {
			// 1. Consultar al SRI
			const resultado = await this.consultarClaveDirecta(claveAcceso);
			const autorizacion = resultado?.RespuestaAutorizacionComprobante?.autorizaciones?.autorizacion;

			if (!autorizacion || autorizacion.estado !== 'AUTORIZADO') {
				throw new BadRequestException(`Comprobante no autorizado o no encontrado: ${claveAcceso}`);
			}

			// 2. Extraer el XML del comprobante que devuelve el SRI
			const xmlFirmado = autorizacion.comprobante;
			if (!xmlFirmado) {
				throw new BadRequestException('El SRI no devolvió el comprobante XML');
			}

			// 3. Formatear fecha
			const fechaAutorizacion = autorizacion.fechaAutorizacion instanceof Date
				? autorizacion.fechaAutorizacion.toISOString()
				: String(autorizacion.fechaAutorizacion ?? '');

			// 4. Construir nombreDoc para guardar
			const get = (tag: string) => xmlFirmado.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`))?.[1]?.trim() || '';
			const nombreDoc = `${get('codDoc')}-${get('estab')}${get('ptoEmi')}-${get('secuencial')}`;

			// 5. Guardar XML actualizado
			this.guardarXmlFirmado(xmlFirmado, nombreDoc);

			// 6. Generar PDF
			try {
				const rutaPdf = await this.facturaPdfService.generarDesdeXml(
					xmlFirmado,
					nombreDoc,
					autorizacion.numeroAutorizacion,
					fechaAutorizacion,
				);
				this.logger.log(`PDF generado: ${nombreDoc}.pdf`);
			} catch (pdfErr: any) {
				this.logger.error(`Error generando PDF: ${pdfErr.message}`);
			}

			// 7. Actualizar BD por si acaso
			this.db.actualizarAutorizacion({
				clave_acceso: claveAcceso,
				numero_autorizacion: autorizacion.numeroAutorizacion,
				fecha_autorizacion: fechaAutorizacion,
				estado: 'AUTORIZADO',
			});

			return {
				estado: 'AUTORIZADO',
				numeroAutorizacion: autorizacion.numeroAutorizacion,
				fechaAutorizacion: fechaAutorizacion,
				xmlFirmado,
				nombreDoc,
			};

		} catch (e: any) {
			this.logger.error(`Error consultarYGenerarPdf: ${e.message}`);
			throw new InternalServerErrorException(e.message);
		}
	}
}

