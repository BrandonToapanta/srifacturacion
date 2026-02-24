import { FirmaService } from '../src/sri/firma.service';
import * as fs from 'fs';
import * as path from 'path';

const firmaService = new FirmaService();
const RUTA_ORIGEN = 'C:\\Users\\ASUS\\OneDrive\\Desktop\\xml_generado';
const RUTA_DESTINO = 'C:\\Users\\ASUS\\OneDrive\\Desktop\\xml_firmado';
const RUTA_P12 = 'C:\\Users\\ASUS\\OneDrive\\Desktop\\privilegio.p12';
const PASS_P12 = 'Nicole70';

async function ejecutar() {
	if (!fs.existsSync(RUTA_DESTINO)) fs.mkdirSync(RUTA_DESTINO);

	const archivos = fs.readdirSync(RUTA_ORIGEN).filter(f => f.endsWith('.xml'));

	for (const archivo of archivos) {
		// LEER COMO BUFFER para ver los bytes reales
		const buffer = fs.readFileSync(path.join(RUTA_ORIGEN, archivo));

		// Diagnóstico: ¿Qué bytes hay al principio?
		console.log(`🔍 Archivo: ${archivo}`);
		console.log(`   Primeros 10 bytes (hex):`, buffer.slice(0, 10).toString('hex'));

		// Intentar convertir a string limpiando posibles basura
		const contenido = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();

		try {
			const firmado = firmaService.firmarXml(contenido, RUTA_P12, PASS_P12);
			fs.writeFileSync(path.join(RUTA_DESTINO, archivo), firmado);
			console.log(`✅ Firmado exitosamente.`);
		} catch (e: any) {
			console.error(`❌ Error al firmar: ${e.message}`);
		}
	}
}

ejecutar();