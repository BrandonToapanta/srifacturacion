import { Injectable, Logger } from '@nestjs/common';
import { SftpService } from './sftp.service';
import { SriService } from './sri.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SftpProcesadorService {

	private readonly logger = new Logger(SftpProcesadorService.name);

	private readonly XML_FIRMADOS_DIR = process.env.XML_FIRMADOS_DIR || 'C:\\xampp\\htdocs\\soga_xml\\firmados';
	private readonly PDF_DIR = process.env.PDF_FACTURAS_DIR || 'C:\\xampp\\htdocs\\soga_xml\\pdf';

	constructor(
		private readonly sftpService: SftpService,
		private readonly sriService: SriService,
	) { }

	// ── Procesar un archivo individual ────────────────────────────────────────
	async procesarArchivo(nombreArchivo: string): Promise<any> {
		let xmlContenido: string;

		// ── 1. Descargar XML — error de red aislado ───────────────────────────
		try {
			xmlContenido = await this.sftpService.leerXmlRemoto(nombreArchivo);
		} catch (e: any) {
			this.logger.error(`Error descargando ${nombreArchivo} (VPN?): ${e.message}`);
			throw new Error(`Error de red al descargar XML: ${e.message}`);
		}

		// ── 2. Procesar en SRI — separado del error de red ────────────────────
		let resultado: any;
		try {
			resultado = await this.sriService.procesarComprobante(xmlContenido);
		} catch (e: any) {
			this.logger.error(`Error SRI procesando ${nombreArchivo}: ${e.message}`);
			throw new Error(`Error SRI: ${e.message}`);
		}

		// ── 3. Subir archivos — solo si fue autorizado ────────────────────────
		if (resultado.estado === 'AUTORIZADO') {
			const nombreDoc = nombreArchivo.replace('.xml', '');

			try {
				const rutaXmlFirmado = path.join(this.XML_FIRMADOS_DIR, `${nombreDoc}.xml`);
				if (fs.existsSync(rutaXmlFirmado)) {
					await this.sftpService.subirXmlFirmado(rutaXmlFirmado, `${nombreDoc}.xml`);
				}
			} catch (e: any) {
				this.logger.error(`Error subiendo XML firmado (VPN?): ${e.message}`);
				// No lanzar — el XML ya fue autorizado, no perder ese resultado
			}

			try {
				const rutaPdf = path.join(this.PDF_DIR, `${nombreDoc}.pdf`);
				if (fs.existsSync(rutaPdf)) {
					await this.sftpService.subirPdf(rutaPdf, `${nombreDoc}.pdf`);
				}
			} catch (e: any) {
				this.logger.error(`Error subiendo PDF (VPN?): ${e.message}`);
			}

			try {
				await this.sftpService.moverXmlProcesado(nombreArchivo);
			} catch (e: any) {
				this.logger.error(`Error moviendo XML a procesados (VPN?): ${e.message}`);
			}
		}

		return resultado;
	}

	// ── Procesar todos los archivos del SFTP ──────────────────────────────────
	async procesarTodos(): Promise<{ procesados: number; errores: number; resultados: any[] }> {
		const resultados: any[] = [];
		let procesados = 0;
		let errores = 0;

		try {
			const archivos = await this.sftpService.listarXmlRemotos();
			this.logger.log(`Archivos encontrados: ${archivos.length}`);

			for (const archivo of archivos) {
				try {
					const resultado = await this.procesarArchivo(archivo);

					if (resultado.estado === 'AUTORIZADO') {
						procesados++;
						resultados.push({
							archivo,
							estado: resultado.estado,
							numeroAutorizacion: resultado.numeroAutorizacion,
						});
					} else {
						errores++;
						resultados.push({
							archivo,
							estado: resultado.estado,
							errores: resultado.errores,
						});
					}

				} catch (e: any) {
					errores++;
					resultados.push({ archivo, estado: 'ERROR', mensaje: e.message });
				}
			}

		} catch (e: any) {
			this.logger.error(`Error conexión SFTP: ${e.message}`);
			throw e;
		}

		this.logger.log(`Finalizado — Procesados: ${procesados}, Errores: ${errores}`);
		return { procesados, errores, resultados };
	}
}