import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import * as soap from 'soap';
import * as https from 'https';
import { FirmaService } from './firma.service';
import { ClaveAccesoService } from './claveAcceso.service';

export interface RespuestaSri {
	estado: 'AUTORIZADO' | 'NO AUTORIZADO' | 'DEVUELTA' | 'EN PROCESO';
	numeroAutorizacion?: string;
	fechaAutorizacion?: string;
	xmlFirmado: string;
	errores?: { identificador: string; mensaje: string; tipo: string }[];
}

@Injectable()
export class SriService {

	private readonly URL_RECEPCION = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl';
	private readonly URL_AUTORIZACION = 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';
	private readonly P12_PATH = process.env.P12_PATH || './privilegio.p12';
	private readonly P12_PASS = process.env.P12_PASS || 'Nicole70';

	// SSL agent para evitar errores de certificado en pruebas
	private readonly sslAgent = new https.Agent({ rejectUnauthorized: false });

	constructor(
		private readonly firmaService: FirmaService,
		private readonly claveAccesoService: ClaveAccesoService,
	) { }

	async procesarComprobante(xml: string): Promise<RespuestaSri> {
		try {
			// Generar e inyectar claveAcceso en el XML
			const xmlConClave = this.inyectarClaveAcceso(xml);

			// Firmar el XML
			const xmlFirmado = this.firmaService.firmarXml(xmlConClave, this.P12_PATH, this.P12_PASS);

			// Extraer y validar la clave de acceso
			const claveAcceso = this.extraerClaveAcceso(xmlFirmado);

			if (!this.claveAccesoService.validarClaveAcceso(claveAcceso)) {
				throw new BadRequestException(`Clave de acceso inválida: ${claveAcceso}`);
			}

			// Enviar al SRI
			const recepcion = await this.enviarComprobante(xmlFirmado);

			if (recepcion.estado === 'DEVUELTA') {
				return { estado: 'DEVUELTA', xmlFirmado, errores: recepcion.errores };
			}

			// Polling de autorización
			const autorizacion = await this.esperarAutorizacion(claveAcceso);

			return { ...autorizacion, xmlFirmado };

		} catch (e: any) {
			console.error('ERROR:', e.message);
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

		console.log('Clave generada:', claveAcceso);

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
		try {
			const client = await soap.createClientAsync(this.URL_RECEPCION, {
				wsdl_options: { agent: this.sslAgent },
			});
			(client as any).httpClient.requestOptions = { agent: this.sslAgent };

			const [result] = await client.validarComprobanteAsync({ xml: xmlBase64 });
			console.log('Resultado recepción raw:', JSON.stringify(result));

			const respuesta = result?.RespuestaRecepcionComprobante;
			const estado = respuesta?.estado;
			const mensajes = respuesta?.comprobantes?.comprobante?.mensajes?.mensaje;
			const errores = mensajes ? (Array.isArray(mensajes) ? mensajes : [mensajes]) : [];

			return { estado, errores };
		} catch (e: any) {
			throw new InternalServerErrorException(`Error WS recepción SRI: ${e.message}`);
		}
	}

	private async esperarAutorizacion(
		claveAcceso: string,
		intentos = 10,       // más intentos
		esperaMs = 8000,     // 8 segundos entre cada intento
	): Promise<Omit<RespuestaSri, 'xmlFirmado'>> {
		for (let i = 0; i < intentos; i++) {
			console.log(`Intento autorización ${i + 1}/${intentos} - esperando ${esperaMs}ms...`);
			await new Promise((r) => setTimeout(r, esperaMs));
			try {
				const client = await soap.createClientAsync(this.URL_AUTORIZACION, {
					wsdl_options: { agent: this.sslAgent },
				});
				(client as any).httpClient.requestOptions = { agent: this.sslAgent };

				const [result] = await client.autorizacionComprobanteAsync({
					claveAccesoComprobante: claveAcceso,
				});

				console.log(`Resultado autorización intento ${i + 1}:`, JSON.stringify(result));

				const respuesta = result?.RespuestaAutorizacionComprobante;

				// Si la respuesta viene null o sin autorizaciones, reintenta
				if (!respuesta?.autorizaciones?.autorizacion) {
					console.log('Sin respuesta aún, reintentando...');
					continue;
				}

				const autorizacion = respuesta.autorizaciones.autorizacion;
				const estado = autorizacion?.estado;
				const mensajes = autorizacion?.mensajes?.mensaje;
				const errores = mensajes
					? (Array.isArray(mensajes) ? mensajes : [mensajes])
					: [];

				console.log('Estado:', estado);

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

				// EN PROCESO o cualquier otro → reintenta
				console.log('En proceso, reintentando...');

			} catch (e: any) {
				console.error(`Error autorización intento ${i + 1}:`, e.message);
				// No lanzar error, reintentar
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

	// Agrega este método en sri.service.ts
	async consultarClaveDirecta(claveAcceso: string) {
		try {
			const client = await soap.createClientAsync(this.URL_AUTORIZACION, {
				wsdl_options: { agent: this.sslAgent },
			});
			(client as any).httpClient.requestOptions = { agent: this.sslAgent };

			const [result] = await client.autorizacionComprobanteAsync({
				claveAccesoComprobante: claveAcceso,
			});

			console.log('Consulta directa resultado:', JSON.stringify(result, null, 2));
			return result;
		} catch (e: any) {
			return { error: e.message };
		}
	}

	async diagnosticarFirma(xmlFirmado: string) {
		const { DOMParser } = require('@xmldom/xmldom');
		const { C14nCanonicalization } = require('xml-crypto');
		const crypto = require('crypto');
		const c14n = new C14nCanonicalization();

		const doc = new DOMParser().parseFromString(xmlFirmado, 'text/xml');

		// 1. Extraer digests declarados en el SignedInfo
		const getTagValue = (tag: string) => {
			const match = xmlFirmado.match(new RegExp(`<ds:${tag}[^>]*>([^<]+)<\/ds:${tag}>`));
			return match?.[1]?.trim();
		};

		const digestDoc = getTagValue('DigestValue');  // primer DigestValue = SignedProperties
		const digestValues = [...xmlFirmado.matchAll(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/g)];
		const declaredDigestSP = digestValues[0]?.[1]?.trim();
		const declaredDigestKI = digestValues[1]?.[1]?.trim();
		const declaredDigestDoc = digestValues[2]?.[1]?.trim();

		// 2. Calcular digest del documento SIN la firma (enveloped-signature)
		// Remover el elemento ds:Signature del XML
		const xmlSinFirma = xmlFirmado.replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, '');
		const docSinFirma = new DOMParser().parseFromString(xmlSinFirma, 'text/xml');
		const docC14n = c14n.process(docSinFirma.documentElement, {
			defaultNs: '',
			ancestorNamespaces: [],
		});
		const calculatedDigestDoc = crypto.createHash('sha1').update(docC14n, 'utf8').digest('base64');

		// 3. Extraer y calcular digest del KeyInfo
		const keyInfoMatch = xmlFirmado.match(/<ds:KeyInfo Id="[^"]*">([\s\S]*?)<\/ds:KeyInfo>/);
		const keyInfoXml = keyInfoMatch?.[0] || '';
		const kiWrapper = `<root xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${keyInfoXml}</root>`;
		const kiDoc = new DOMParser().parseFromString(kiWrapper, 'text/xml');
		const kiEl = kiDoc.documentElement.firstChild as any;
		const kiC14n = c14n.process(kiEl, {
			defaultNs: '',
			ancestorNamespaces: [{ prefix: 'ds', namespaceURI: 'http://www.w3.org/2000/09/xmldsig#' }],
		});
		const calculatedDigestKI = crypto.createHash('sha1').update(kiC14n, 'utf8').digest('base64');

		// 4. Extraer y calcular digest del SignedProperties
		const spMatch = xmlFirmado.match(/<etsi:SignedProperties[\s\S]*?<\/etsi:SignedProperties>/);
		const spXml = spMatch?.[0] || '';
		const spWrapper = `<root xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#">${spXml}</root>`;
		const spDoc = new DOMParser().parseFromString(spWrapper, 'text/xml');
		const spEl = spDoc.documentElement.firstChild as any;
		const spC14n = c14n.process(spEl, {
			defaultNs: '',
			ancestorNamespaces: [
				{ prefix: 'ds', namespaceURI: 'http://www.w3.org/2000/09/xmldsig#' },
				{ prefix: 'etsi', namespaceURI: 'http://uri.etsi.org/01903/v1.3.2#' },
			],
		});
		const calculatedDigestSP = crypto.createHash('sha1').update(spC14n, 'utf8').digest('base64');

		// 5. Verificar la firma del SignedInfo
		const forge = require('node-forge');

		// Extraer el certificado del KeyInfo
		const certB64Match = xmlFirmado.match(/<ds:X509Certificate>\s*([\s\S]*?)\s*<\/ds:X509Certificate>/);
		const certB64 = certB64Match?.[1]?.replace(/\s/g, '') || '';
		const certDer = forge.util.decode64(certB64);
		const certAsn1 = forge.asn1.fromDer(certDer);
		const cert = forge.pki.certificateFromAsn1(certAsn1);
		const publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);

		// Extraer el SignedInfo del XML
		const signedInfoMatch = xmlFirmado.match(/(<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>)/);
		const signedInfoXml = signedInfoMatch?.[1] || '';

		// Extraer el SignatureValue
		const sigValueMatch = xmlFirmado.match(/<ds:SignatureValue[^>]*>\s*([\s\S]*?)\s*<\/ds:SignatureValue>/);
		const sigValueB64 = sigValueMatch?.[1]?.replace(/\s/g, '') || '';
		const signature = Buffer.from(sigValueB64, 'base64');

		// Intentar verificar con diferentes canonicalizaciones

		// Opción A: SignedInfo con xmlns:ds del padre (como está en el documento)
		const siWrapperA = `<root xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}</root>`;
		const siDocA = new DOMParser().parseFromString(siWrapperA, 'text/xml');
		const siElA = siDocA.documentElement.firstChild as any;
		const siC14nA = c14n.process(siElA, {
			defaultNs: '',
			ancestorNamespaces: [{ prefix: 'ds', namespaceURI: 'http://www.w3.org/2000/09/xmldsig#' }],
		});

		// Opción B: SignedInfo standalone (con xmlns:ds en el propio elemento)
		const siDocB = new DOMParser().parseFromString(signedInfoXml, 'text/xml');
		const siC14nB = c14n.process(siDocB.documentElement, {
			defaultNs: '',
			ancestorNamespaces: [],
		});

		// Verificar ambas opciones
		const verifyA = crypto.createVerify('RSA-SHA1');
		verifyA.update(siC14nA, 'utf8');
		const validA = verifyA.verify(publicKeyPem, signature);

		const verifyB = crypto.createVerify('RSA-SHA1');
		verifyB.update(siC14nB, 'utf8');
		const validB = verifyB.verify(publicKeyPem, signature);

		return {
			signedProperties: {
				declarado: declaredDigestSP,
				calculado: calculatedDigestSP,
				coincide: declaredDigestSP === calculatedDigestSP,
			},
			keyInfo: {
				declarado: declaredDigestKI,
				calculado: calculatedDigestKI,
				coincide: declaredDigestKI === calculatedDigestKI,
			},
			documento: {
				declarado: declaredDigestDoc,
				calculado: calculatedDigestDoc,
				coincide: declaredDigestDoc === calculatedDigestDoc,
			},
			firma: {
				opcionA_conAncestorNs: { valida: validA, c14n: siC14nA.substring(0, 150) },
				opcionB_standalone: { valida: validB, c14n: siC14nB.substring(0, 150) },
			}
		};
	}
}

