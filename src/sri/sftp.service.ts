import { Injectable, Logger } from '@nestjs/common';
import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SftpService {

	private readonly logger = new Logger(SftpService.name);

	private readonly config = {
		host: process.env.SFTP_HOST || '192.168.1.100',
		port: parseInt(process.env.SFTP_PORT || '22'),
		username: process.env.SFTP_USER || 'usuario',
		password: process.env.SFTP_PASS || 'contraseña',
		readyTimeout: 20000,   // 20 segundos para conectar
		retries: 3,       // reintentar 3 veces
		retry_factor: 2,       // factor de espera entre reintentos
		retry_minTimeout: 2000,  // mínimo 2s entre reintentos
	};

	private readonly SFTP_XML_DIR = process.env.SFTP_XML_DIR || '/facturas/pendientes';
	private readonly SFTP_PROCESADOS_DIR = process.env.SFTP_PROCESADOS_DIR || '/facturas/procesados';
	private readonly SFTP_FIRMADOS_DIR = process.env.SFTP_FIRMADOS_DIR || '/facturas/firmados';
	// Por defecto usamos /xml/pdfs (anteriormente /facturas/pdf). Se puede sobrescribir con SFTP_PDF_DIR.
	private readonly SFTP_PDF_DIR = process.env.SFTP_PDF_DIR || '/xml/pdfs';
	private readonly LOCAL_TEMP_DIR = process.env.LOCAL_TEMP_DIR || 'C:\\temp\\sftp_temp';

	// ── Conexión ──────────────────────────────────────────────────────────────
	private async conectar(): Promise<SftpClient> {
		const sftp = new SftpClient();
		try {
			await sftp.connect(this.config);
			return sftp;
		} catch (e: any) {
			this.logger.error(`Verifica que la VPN esté activa y que el host ${this.config.host} sea accesible`);
			throw new Error(`SFTP sin conexión: ${e.message}`);
		}
	}

	// ── Listar XML remotos pendientes ─────────────────────────────────────────
	async listarXmlRemotos(): Promise<string[]> {
		const sftp = await this.conectar();
		try {
			// Crear directorio si no existe
			await sftp.mkdir(this.SFTP_XML_DIR, true);

			const archivos = await sftp.list(this.SFTP_XML_DIR);
			const xmls = archivos
				.filter(f => f.type === '-' && f.name.endsWith('.xml'))
				.map(f => f.name);

			return xmls;
		} finally {
			await sftp.end();
		}
	}

	// ── Descargar XML remoto a temp local ─────────────────────────────────────
	async descargarXml(nombreArchivo: string): Promise<string> {
		const sftp = await this.conectar();
		try {
			if (!fs.existsSync(this.LOCAL_TEMP_DIR)) {
				fs.mkdirSync(this.LOCAL_TEMP_DIR, { recursive: true });
			}

			const rutaRemota = `${this.SFTP_XML_DIR}/${nombreArchivo}`;
			const rutaLocal = path.join(this.LOCAL_TEMP_DIR, nombreArchivo);

			await sftp.get(rutaRemota, rutaLocal);
			return rutaLocal;
		} finally {
			await sftp.end();
		}
	}

	// ── Leer contenido XML remoto y limpiar temp ──────────────────────────────
	async leerXmlRemoto(nombreArchivo: string): Promise<string> {
		const rutaLocal = await this.descargarXml(nombreArchivo);
		try {
			const contenido = fs.readFileSync(rutaLocal, 'utf8');
			return contenido;
		} finally {
			// Limpiar archivo temporal
			if (fs.existsSync(rutaLocal)) {
				fs.unlinkSync(rutaLocal);
			}
		}
	}

	// ── Subir XML firmado al servidor remoto ──────────────────────────────────
	async subirXmlFirmado(rutaLocal: string, nombreArchivo: string): Promise<void> {
		const sftp = await this.conectar();
		try {
			await sftp.mkdir(this.SFTP_FIRMADOS_DIR, true);

			const rutaRemota = `${this.SFTP_FIRMADOS_DIR}/${nombreArchivo}`;
			await sftp.put(rutaLocal, rutaRemota);
		} finally {
			await sftp.end();
		}
	}

	// ── Subir PDF al servidor remoto ──────────────────────────────────────────
	async subirPdf(rutaLocal: string, nombreArchivo: string): Promise<void> {
		const sftp = await this.conectar();
		try {
			// Asegurar que el archivo local existe antes de intentar subir
			if (!fs.existsSync(rutaLocal)) {
				throw new Error(`PDF local no encontrado: ${rutaLocal}`);
			}

			await sftp.mkdir(this.SFTP_PDF_DIR, true);

			const rutaRemota = `${this.SFTP_PDF_DIR}/${nombreArchivo}`;
			try {
				await sftp.put(rutaLocal, rutaRemota);
				this.logger.log(`PDF subido: ${nombreArchivo}`);
			} catch (putErr: any) {
				this.logger.error(`Error subiendo PDF ${nombreArchivo}: ${putErr.message}`);
				throw putErr;
			}
		} finally {
			await sftp.end();
		}
	}

	// ── Mover XML original a carpeta procesados ───────────────────────────────
	async moverXmlProcesado(nombreArchivo: string): Promise<void> {
		const sftp = await this.conectar();
		try {
			await sftp.mkdir(this.SFTP_PROCESADOS_DIR, true);

			const rutaOrigen = `${this.SFTP_XML_DIR}/${nombreArchivo}`;
			const rutaDestino = `${this.SFTP_PROCESADOS_DIR}/${nombreArchivo}`;

			await sftp.rename(rutaOrigen, rutaDestino);
			this.logger.log(`XML movido a procesados: ${nombreArchivo}`);
		} finally {
			await sftp.end();
		}
	}

	// ── Verificar conexión ────────────────────────────────────────────────────
	async verificarConexion(): Promise<boolean> {
		try {
			const sftp = await this.conectar();
			await sftp.end();
			return true;
		} catch (e: any) {
			this.logger.error(`Error conexión SFTP: ${e.message}`);
			return false;
		}
	}
}