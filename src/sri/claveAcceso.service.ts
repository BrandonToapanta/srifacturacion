import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class ClaveAccesoService {

	private readonly logger = new Logger(ClaveAccesoService.name);

	generarClaveAcceso(params: {
		fechaEmision: string;  // formato: DD/MM/YYYY
		codDoc: string;        // 01=factura, 04=nota crédito, 05=nota débito, 06=guía remisión, 07=retención
		ruc: string;           // 13 dígitos
		ambiente: string;      // 1=pruebas, 2=producción
		estab: string;         // 3 dígitos
		ptoEmi: string;        // 3 dígitos
		secuencial: string;    // 9 dígitos
		tipoEmision: string;   // 1=normal
	}): string {

		// Formatear fecha → ddmmaaaa 
		const fechaFormateada = this.formatearFecha(params.fechaEmision);

		// Código numérico aleatorio de 8 dígitos 
		const codigoNumerico = this.generarCodigoNumerico();

		const clave48 =
			fechaFormateada +                           // 8 dígitos  (ddmmaaaa)
			params.codDoc.padStart(2, '0') +            // 2 dígitos
			params.ruc.padStart(13, '0') +              // 13 dígitos
			params.ambiente.padStart(1, '0') +          // 1 dígito
			params.estab.padStart(3, '0') +             // 3 dígitos
			params.ptoEmi.padStart(3, '0') +            // 3 dígitos
			params.secuencial.padStart(9, '0') +        // 9 dígitos
			codigoNumerico +                            // 8 dígitos
			params.tipoEmision.padStart(1, '0');        // 1 dígito

		if (clave48.length !== 48) {
			throw new BadRequestException(`Clave de 48 dígitos inválida, longitud: ${clave48.length}`);
		}

		// Calcular dígito verificador módulo 11
		const digitoVerificador = this.moduloOnce(clave48);

		const claveAcceso = clave48 + digitoVerificador;

		this.logger.log(`Clave de acceso generada: ${claveAcceso}`);

		return claveAcceso;
	}

	// Módulo 11 (algoritmo del SRI)
	private moduloOnce(clave48: string): string {
		const pesos = [2, 3, 4, 5, 6, 7];
		let suma = 0;

		for (let i = clave48.length - 1; i >= 0; i--) {
			const digito = parseInt(clave48[i]);
			const peso = pesos[(clave48.length - 1 - i) % pesos.length];
			suma += digito * peso;
		}

		const residuo = suma % 11;

		// Tabla de conversión del SRI
		if (residuo === 0) return '0';
		if (residuo === 1) return '1';
		return (11 - residuo).toString();
	}

	private formatearFecha(fecha: string): string {
		// Acepta DD/MM/YYYY o YYYY-MM-DD
		if (fecha.includes('/')) {
			const [dia, mes, anio] = fecha.split('/');
			return dia.padStart(2, '0') + mes.padStart(2, '0') + anio;
		} else if (fecha.includes('-')) {
			const [anio, mes, dia] = fecha.split('-');
			return dia.padStart(2, '0') + mes.padStart(2, '0') + anio;
		}
		throw new BadRequestException('Formato de fecha inválido. Use DD/MM/YYYY o YYYY-MM-DD');
	}

	// Código numérico aleatorio de 8 dígitos
	private generarCodigoNumerico(): string {
		const buffer = crypto.randomBytes(4);
		const numero = buffer.readUInt32BE(0) % 90000000 + 10000000;
		return numero.toString();
	}

	// Validar una clave de acceso existente
	validarClaveAcceso(claveAcceso: string): boolean {
		if (claveAcceso.length !== 49) return false;
		const clave48 = claveAcceso.substring(0, 48);
		const digitoEsperado = this.moduloOnce(clave48);
		return claveAcceso[48] === digitoEsperado;
	}
}