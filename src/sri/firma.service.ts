import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class FirmaService {

	private readonly logger = new Logger(FirmaService.name);

	// Rutas del firmador Java — ajusta según tu servidor
	private readonly JAR_PATH = process.env.FIRMA_JAR_PATH || 'C:\\Users\\ASUS\\OneDrive\\Desktop\\srifacturacion\\scripts\\firmaxml\\firma.jar';
	private readonly P12_PATH = process.env.P12_PATH || './privilegio.p12';
	private readonly P12_PASS = process.env.P12_PASS || 'TuContraseñaP12';
	private readonly TEMP_DIR = process.env.FIRMA_TEMP_DIR || os.tmpdir();

	firmarXml(xmlString: string, p12Path?: string, pass?: string): string {
		const p12 = p12Path || this.P12_PATH;
		const clave = pass || this.P12_PASS;

		// Guardar XML en archivo temporal de entrada
		const timestamp = Date.now();
		const inputFile = path.join(this.TEMP_DIR, `xml_input_${timestamp}.xml`);
		const outputDir = path.join(this.TEMP_DIR, `firmados_${timestamp}`);
		const fileName = `xml_input_${timestamp}.xml`;
		const outputFile = path.join(outputDir, fileName);

		try {
			// Crear directorio de salida
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			// Escribir XML de entrada
			fs.writeFileSync(inputFile, xmlString, 'utf8');

			// Llamar al firmador Java
			// Comando: java -jar firma.jar <p12> <pass> <xml_input> <output_dir> <filename>
			const comando = `java -jar "${this.JAR_PATH}" "${p12}" "${clave}" "${inputFile}" "${outputDir}" "${fileName}"`;

			execSync(comando, {
				timeout: 30000,    // 30 segundos máximo
				stdio: 'pipe',
			});

			// Leer XML firmado
			if (!fs.existsSync(outputFile)) {
				throw new Error(`El firmador no generó el archivo de salida: ${outputFile}`);
			}

			const xmlFirmado = fs.readFileSync(outputFile, 'utf8');
			this.logger.log(`XML firmado generado exitosamente`);

			return xmlFirmado;

		} finally {
			// Limpiar archivos temporales
			try {
				if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
				if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
				if (fs.existsSync(outputDir)) fs.rmdirSync(outputDir);
			} catch (e) {
				this.logger.warn('No se pudieron limpiar temporales:', e.message);
			}
		}
	}
}